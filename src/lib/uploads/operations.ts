import "server-only"

import {
  UploadCleanupStatus,
  UploadFailureCategory,
  UploadFailureStage,
  UploadStatus,
  type UploadAttempt,
} from "@prisma/client"
import { prisma } from "../db"
import type { StorageConfiguration } from "../storage/config"
import type { StorageAdapter } from "../storage/types"
import { UploadLifecycleError } from "./errors"
import { markUploadFailed, recordCleanupResult, recordCompleted } from "./lifecycle"
import type { StoredObjectProbeLocator, UploadReconciliationProbes } from "./reconciliation"

export const DEFAULT_OPERATION_BATCH_LIMIT = 50
export const DEFAULT_STALE_ATTEMPT_MS = 60 * 60 * 1000

/**
 * Destructive or evidence-producing operator tooling must target a real S3
 * configuration. Local/memory storage can never be cleaned by the operator
 * tools and can never produce UPLOAD_PLATFORM_LIMITS_VERIFIED evidence.
 */
export function assertOperatorS3Storage(configuration: Pick<StorageConfiguration, "provider">, purpose: string): void {
  if (configuration.provider !== "s3") {
    throw new Error(`Refusing to run: ${purpose} requires STORAGE_PROVIDER=s3. Local storage is never a valid target for this tool.`)
  }
}

export type UploadOperationAction = "RECOVERED" | "CLEANED" | "SKIPPED" | "CONFLICT" | "FAILED"

export interface UploadOperationOutcome {
  attemptId: string
  organizationId: string
  fromStatus: UploadAttempt["status"]
  action: UploadOperationAction
  /** Bounded machine-readable reason; never a key, bucket, filename, or provider error. */
  detail: string
}

export interface UploadOperationSummary {
  attempted: number
  recovered: number
  cleaned: number
  skipped: number
  conflicted: number
  failed: number
  outcomes: UploadOperationOutcome[]
}

function summarize(outcomes: UploadOperationOutcome[]): UploadOperationSummary {
  return {
    attempted: outcomes.length,
    recovered: outcomes.filter((outcome) => outcome.action === "RECOVERED").length,
    cleaned: outcomes.filter((outcome) => outcome.action === "CLEANED").length,
    skipped: outcomes.filter((outcome) => outcome.action === "SKIPPED").length,
    conflicted: outcomes.filter((outcome) => outcome.action === "CONFLICT").length,
    failed: outcomes.filter((outcome) => outcome.action === "FAILED").length,
    outcomes,
  }
}

export interface RecoverStuckUploadsOptions {
  now?: Date
  staleAttemptMs?: number
  batchLimit?: number
  dryRun?: boolean
}

const RECOVERY_FAILURE_BY_STATUS: Partial<
  Record<UploadStatus, { stage: UploadFailureStage; category: UploadFailureCategory }>
> = {
  INITIATED: { stage: UploadFailureStage.RECEIVE, category: UploadFailureCategory.INTERNAL_FAILURE },
  RECEIVING: { stage: UploadFailureStage.RECEIVE, category: UploadFailureCategory.INTERNAL_FAILURE },
  QUARANTINED: { stage: UploadFailureStage.VALIDATION, category: UploadFailureCategory.INTERNAL_FAILURE },
  VALIDATING: { stage: UploadFailureStage.VALIDATION, category: UploadFailureCategory.INTERNAL_FAILURE },
  VALIDATED: { stage: UploadFailureStage.SCAN, category: UploadFailureCategory.INTERNAL_FAILURE },
  SCANNING: { stage: UploadFailureStage.SCAN, category: UploadFailureCategory.SCAN_UNAVAILABLE },
  PROMOTING: { stage: UploadFailureStage.PROMOTION, category: UploadFailureCategory.PROMOTION_FAILURE },
  PROMOTED: { stage: UploadFailureStage.PROMOTION, category: UploadFailureCategory.PROMOTION_FAILURE },
  LINKING: { stage: UploadFailureStage.LINKAGE, category: UploadFailureCategory.INTERNAL_FAILURE },
}

const STALE_RECOVERY_STATUSES: UploadStatus[] = [
  UploadStatus.INITIATED,
  UploadStatus.RECEIVING,
  UploadStatus.PROMOTING,
  UploadStatus.PROMOTED,
  UploadStatus.LINKING,
]

const EXPIRED_RECOVERY_STATUSES: UploadStatus[] = [
  UploadStatus.QUARANTINED,
  UploadStatus.VALIDATING,
  UploadStatus.VALIDATED,
  UploadStatus.SCANNING,
]

/**
 * Fails abandoned or crash-stuck attempts through the guarded lifecycle
 * transitions only. A live completion racing this recovery keeps its guarded
 * update; the loser records a bounded CONFLICT outcome and nothing else
 * changes. This function never touches storage.
 */
export async function recoverStuckUploadAttempts(options: RecoverStuckUploadsOptions = {}): Promise<UploadOperationSummary> {
  const now = options.now ?? new Date()
  const staleBefore = new Date(now.getTime() - (options.staleAttemptMs ?? DEFAULT_STALE_ATTEMPT_MS))
  const batchLimit = options.batchLimit ?? DEFAULT_OPERATION_BATCH_LIMIT
  const candidates = await prisma.uploadAttempt.findMany({
    where: {
      OR: [
        { status: { in: STALE_RECOVERY_STATUSES }, updatedAt: { lt: staleBefore } },
        { status: { in: EXPIRED_RECOVERY_STATUSES }, expiresAt: { lte: now } },
      ],
    },
    orderBy: { updatedAt: "asc" },
    take: batchLimit,
    select: { id: true, organizationId: true, status: true },
  })

  const outcomes: UploadOperationOutcome[] = []
  for (const candidate of candidates) {
    const failure = RECOVERY_FAILURE_BY_STATUS[candidate.status]
    const base = { attemptId: candidate.id, organizationId: candidate.organizationId, fromStatus: candidate.status }
    if (!failure) {
      outcomes.push({ ...base, action: "SKIPPED", detail: "STATUS_NOT_RECOVERABLE" })
      continue
    }
    if (options.dryRun) {
      outcomes.push({ ...base, action: "SKIPPED", detail: "DRY_RUN" })
      continue
    }
    try {
      await markUploadFailed(
        candidate.id,
        candidate.status as Exclude<UploadStatus, "COMPLETED" | "FAILED">,
        failure.stage,
        failure.category,
        now,
      )
      outcomes.push({ ...base, action: "RECOVERED", detail: `FAILED_AT_${failure.stage}` })
    } catch (error) {
      if (error instanceof UploadLifecycleError) {
        outcomes.push({ ...base, action: "CONFLICT", detail: "STATE_CHANGED_CONCURRENTLY" })
      } else {
        outcomes.push({ ...base, action: "FAILED", detail: "DATABASE_ERROR" })
      }
    }
  }
  return summarize(outcomes)
}

export interface ExecuteQuarantineCleanupOptions {
  now?: Date
  batchLimit?: number
  dryRun?: boolean
}

/**
 * Deletes only the exact quarantine object version recorded on each eligible
 * attempt. FAILED attempts wait for their recorded expiry (24 h ordinary,
 * 7 days infected/suspect — stamped at failure time); linked attempts are
 * eligible immediately because the durable owner already exists. Durable
 * objects are never touched. Every result is recorded through guarded
 * transitions, and a provider failure leaves the attempt PENDING for rerun.
 */
export async function executeQuarantineCleanup(
  adapter: StorageAdapter,
  options: ExecuteQuarantineCleanupOptions = {},
): Promise<UploadOperationSummary> {
  const now = options.now ?? new Date()
  const batchLimit = options.batchLimit ?? DEFAULT_OPERATION_BATCH_LIMIT
  const candidates = await prisma.uploadAttempt.findMany({
    where: {
      cleanupStatus: UploadCleanupStatus.PENDING,
      status: { in: [UploadStatus.FAILED, UploadStatus.LINKED_CLEANUP_PENDING] },
    },
    orderBy: { updatedAt: "asc" },
    take: batchLimit,
  })

  const outcomes: UploadOperationOutcome[] = []
  for (const attempt of candidates) {
    const base = { attemptId: attempt.id, organizationId: attempt.organizationId, fromStatus: attempt.status }
    if (attempt.status === UploadStatus.FAILED && attempt.expiresAt > now) {
      outcomes.push({ ...base, action: "SKIPPED", detail: "RETENTION_HOLD" })
      continue
    }
    const hasRecordedObject = Boolean(attempt.quarantineObjectKey)
    if (hasRecordedObject && !attempt.quarantineObjectVersionId) {
      // Exact-version deletion is mandatory; an attempt without a recorded
      // version is left for reconciliation review rather than guessed at.
      outcomes.push({ ...base, action: "SKIPPED", detail: "MISSING_OBJECT_VERSION" })
      continue
    }
    if (options.dryRun) {
      outcomes.push({ ...base, action: "SKIPPED", detail: "DRY_RUN" })
      continue
    }
    try {
      if (hasRecordedObject) {
        await adapter.deleteObject({
          key: attempt.quarantineObjectKey as string,
          location: "quarantine",
          versionId: attempt.quarantineObjectVersionId as string,
        })
      }
    } catch {
      outcomes.push({ ...base, action: "FAILED", detail: "PROVIDER_DELETE_ERROR" })
      continue
    }
    try {
      if (attempt.status === UploadStatus.LINKED_CLEANUP_PENDING) {
        await recordCompleted(attempt.id, UploadStatus.LINKED_CLEANUP_PENDING, now)
      } else {
        await recordCleanupResult(attempt.id, UploadCleanupStatus.COMPLETED, now)
      }
      outcomes.push({ ...base, action: "CLEANED", detail: hasRecordedObject ? "EXACT_VERSION_DELETED" : "NO_OBJECT_RECORDED" })
    } catch (error) {
      if (error instanceof UploadLifecycleError) {
        outcomes.push({ ...base, action: "CONFLICT", detail: "STATE_CHANGED_CONCURRENTLY" })
      } else {
        outcomes.push({ ...base, action: "FAILED", detail: "DATABASE_ERROR" })
      }
    }
  }
  return summarize(outcomes)
}

export type StorageProbeFailureKind = "DURABLE_PROBE_ERROR" | "STORED_OBJECT_PROBE_ERROR" | "UNPROBEABLE_LOCATION"

export interface StorageProbeFailure {
  kind: StorageProbeFailureKind
  resourceId?: string
}

export interface StorageBackedProbes {
  probes: UploadReconciliationProbes
  failures: StorageProbeFailure[]
}

/**
 * Read-only storage probes for the reconciliation report. A probe error or
 * unprobeable location is reported as a failure and treated as "exists" so
 * that transient provider trouble can never produce a missing-object finding
 * (and therefore can never motivate a destructive follow-up).
 */
export function buildStorageBackedProbes(adapter: StorageAdapter, configuration: StorageConfiguration): StorageBackedProbes {
  const failures: StorageProbeFailure[] = []
  const probes: UploadReconciliationProbes = {
    async durableKeyExists(key: string): Promise<boolean> {
      try {
        return await adapter.objectExists({ key, location: "durable" })
      } catch {
        failures.push({ kind: "DURABLE_PROBE_ERROR" })
        return true
      }
    },
    async storedObjectExists(locator: StoredObjectProbeLocator): Promise<boolean> {
      if (locator.provider !== "S3") {
        failures.push({ kind: "UNPROBEABLE_LOCATION" })
        return true
      }
      const location =
        locator.bucket === configuration.durableBucket
          ? "durable"
          : locator.bucket === configuration.quarantineBucket
            ? "quarantine"
            : null
      if (!location) {
        failures.push({ kind: "UNPROBEABLE_LOCATION" })
        return true
      }
      try {
        return await adapter.objectExists({ key: locator.key, location, versionId: locator.versionId })
      } catch {
        failures.push({ kind: "STORED_OBJECT_PROBE_ERROR" })
        return true
      }
    },
  }
  return { probes, failures }
}
