import { createHash } from "node:crypto"
import {
  Prisma,
  StoredObjectLifecycleStatus,
  StoredObjectMalwareStatus,
  UploadActorType,
  UploadCleanupStatus,
  UploadFailureCategory,
  UploadFailureStage,
  UploadStatus,
  type UploadAttempt,
} from "@prisma/client"
import { prisma } from "../db"
import { UploadLifecycleError } from "./errors"
import { getUploadValidationProfile } from "./profiles"
import {
  MAX_UPLOAD_BYTES,
  ORDINARY_QUARANTINE_RETENTION_MS,
  SUSPECT_QUARANTINE_RETENTION_MS,
  type InitiatedUploadInput,
  type QuarantineMetadata,
  type SafeUploadSummary,
  type VerifiedPromotionMetadata,
} from "./types"
import type { MalwareScanResult } from "./scanner"

type AttemptClient = Pick<Prisma.TransactionClient, "uploadAttempt">
type LifecycleDatabase = Pick<typeof prisma, "$transaction">

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CUID_PATTERN = /^c[a-z0-9]{20,31}$/
const SHA256_PATTERN = /^[a-f0-9]{64}$/
const KEY_LITERALS = new Set([
  "organizations",
  "templates",
  "source",
  "clients",
  "packets",
  "documents",
  "versions",
  "supporting",
  "portal-requests",
  "uploads",
  "final",
  "signatures",
])

const ACTIVE_TRANSITIONS: Readonly<Record<UploadStatus, readonly UploadStatus[]>> = {
  INITIATED: [UploadStatus.RECEIVING, UploadStatus.FAILED],
  RECEIVING: [UploadStatus.QUARANTINED, UploadStatus.FAILED],
  QUARANTINED: [UploadStatus.VALIDATING, UploadStatus.FAILED],
  VALIDATING: [UploadStatus.VALIDATED, UploadStatus.FAILED],
  VALIDATED: [UploadStatus.SCANNING, UploadStatus.FAILED],
  SCANNING: [UploadStatus.PROMOTING, UploadStatus.FAILED],
  PROMOTING: [UploadStatus.PROMOTED, UploadStatus.FAILED],
  PROMOTED: [UploadStatus.LINKING, UploadStatus.FAILED],
  LINKING: [UploadStatus.LINKED_CLEANUP_PENDING, UploadStatus.COMPLETED, UploadStatus.FAILED],
  LINKED_CLEANUP_PENDING: [UploadStatus.COMPLETED, UploadStatus.FAILED],
  COMPLETED: [],
  FAILED: [],
}

export function hashIdempotencyKey(idempotencyKey: string): string {
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new UploadLifecycleError("INVALID_IDEMPOTENCY_KEY", "A UUID idempotency key is required.")
  }
  return createHash("sha256").update(idempotencyKey.toLowerCase(), "utf8").digest("hex")
}

function requireOpaqueId(value: string, label: string): string {
  if (!UUID_PATTERN.test(value) && !CUID_PATTERN.test(value)) {
    throw new UploadLifecycleError("INVALID_IDENTIFIER", `${label} must be an opaque resource identifier.`)
  }
  return value
}

function requireOpaqueStorageKey(key: string, organizationId?: string): string {
  const segments = key.split("/")
  if (
    segments.length < 4 ||
    segments[0] !== "organizations" ||
    (organizationId !== undefined && segments[1] !== organizationId)
  ) {
    throw new UploadLifecycleError("INVALID_IDENTIFIER", "The planned object key must be scoped to the upload organization.")
  }
  for (const rawSegment of segments) {
    const segment = rawSegment.endsWith(".pdf") ? rawSegment.slice(0, -4) : rawSegment
    if (!KEY_LITERALS.has(segment) && !UUID_PATTERN.test(segment) && !CUID_PATTERN.test(segment)) {
      throw new UploadLifecycleError("INVALID_IDENTIFIER", "The planned object key may contain only approved namespaces and opaque IDs.")
    }
  }
  return key
}

export function assertUploadTransition(current: UploadStatus, next: UploadStatus): void {
  if (!ACTIVE_TRANSITIONS[current].includes(next)) {
    throw new UploadLifecycleError(
      "INVALID_TRANSITION",
      `Upload lifecycle transition ${current} to ${next} is not allowed.`,
      UploadFailureCategory.CONFLICT,
    )
  }
}

export function isTerminalUploadStatus(status: UploadStatus): boolean {
  return status === UploadStatus.COMPLETED || status === UploadStatus.FAILED
}

export type IdempotencyDisposition = "RETURN_COMPLETED" | "IN_PROGRESS" | "FAILED_TERMINAL"

export function getIdempotencyDisposition(status: UploadStatus): IdempotencyDisposition {
  if (status === UploadStatus.COMPLETED) return "RETURN_COMPLETED"
  if (status === UploadStatus.FAILED) return "FAILED_TERMINAL"
  return "IN_PROGRESS"
}

function actorFields(input: InitiatedUploadInput): {
  actorType: UploadActorType
  actorIdentityId: string
  staffUserId: string | null
  portalUserId: string | null
} {
  const actor = input.actor as { type?: string; staffUserId?: string; portalUserId?: string }
  if (actor.type === "STAFF" && actor.staffUserId && !actor.portalUserId) {
    return {
      actorType: UploadActorType.STAFF,
      actorIdentityId: requireOpaqueId(actor.staffUserId, "staffUserId"),
      staffUserId: requireOpaqueId(actor.staffUserId, "staffUserId"),
      portalUserId: null,
    }
  }
  if (actor.type === "PORTAL" && actor.portalUserId && !actor.staffUserId) {
    return {
      actorType: UploadActorType.PORTAL,
      actorIdentityId: requireOpaqueId(actor.portalUserId, "portalUserId"),
      staffUserId: null,
      portalUserId: requireOpaqueId(actor.portalUserId, "portalUserId"),
    }
  }
  throw new UploadLifecycleError("INVALID_ACTOR", "Exactly one opaque upload actor identity is required.")
}

export function buildInitiatedUploadData(input: InitiatedUploadInput): Prisma.UploadAttemptUncheckedCreateInput {
  const now = input.now ?? new Date()
  const profile = getUploadValidationProfile(input.uploadKind)
  if (input.expectedSizeBytes !== undefined && (input.expectedSizeBytes < 0 || input.expectedSizeBytes > profile.maxBytes)) {
    throw new UploadLifecycleError("SIZE_LIMIT", "The declared upload size exceeds the profile limit.", UploadFailureCategory.SIZE_LIMIT)
  }
  return {
    organizationId: requireOpaqueId(input.organizationId, "organizationId"),
    uploadKind: input.uploadKind,
    status: UploadStatus.INITIATED,
    intendedOwnerType: input.intendedOwnerType,
    intendedOwnerId: requireOpaqueId(input.intendedOwnerId, "intendedOwnerId"),
    parentResourceId: input.parentResourceId ? requireOpaqueId(input.parentResourceId, "parentResourceId") : null,
    ...actorFields(input),
    idempotencyKeyHash: hashIdempotencyKey(input.idempotencyKey),
    artifactId: requireOpaqueId(input.artifactId, "artifactId"),
    declaredMimeType: input.declaredMimeType ?? null,
    expectedSizeBytes: input.expectedSizeBytes === undefined ? null : BigInt(input.expectedSizeBytes),
    plannedDurableObjectKey: requireOpaqueStorageKey(input.plannedDurableObjectKey, input.organizationId),
    malwareStatus: StoredObjectMalwareStatus.NOT_SCANNED,
    cleanupStatus: UploadCleanupStatus.NOT_REQUIRED,
    expiresAt: new Date(now.getTime() + ORDINARY_QUARANTINE_RETENTION_MS),
    createdAt: now,
    updatedAt: now,
  }
}

export async function createInitiatedUploadAttempt(input: InitiatedUploadInput, client: AttemptClient = prisma): Promise<UploadAttempt> {
  const data = buildInitiatedUploadData(input)
  try {
    return await client.uploadAttempt.create({ data })
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    const existing = await client.uploadAttempt.findUnique({
      where: {
        organizationId_actorType_actorIdentityId_uploadKind_idempotencyKeyHash: {
          organizationId: data.organizationId,
          actorType: data.actorType,
          actorIdentityId: data.actorIdentityId,
          uploadKind: data.uploadKind,
          idempotencyKeyHash: data.idempotencyKeyHash,
        },
      },
    })
    if (!existing) throw error
    return existing
  }
}

async function transition(
  client: AttemptClient,
  attemptId: string,
  current: UploadStatus,
  next: UploadStatus,
  data: Prisma.UploadAttemptUpdateManyMutationInput = {},
): Promise<UploadAttempt> {
  assertUploadTransition(current, next)
  const result = await client.uploadAttempt.updateMany({ where: { id: attemptId, status: current }, data: { ...data, status: next } })
  if (result.count !== 1) {
    throw new UploadLifecycleError("CONFLICT", "The upload attempt changed concurrently or is in the wrong state.", UploadFailureCategory.CONFLICT)
  }
  const attempt = await client.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt) throw new UploadLifecycleError("CONFLICT", "The upload attempt is no longer available.")
  return attempt
}

export function beginReceiving(attemptId: string, client: AttemptClient = prisma): Promise<UploadAttempt> {
  return transition(client, attemptId, UploadStatus.INITIATED, UploadStatus.RECEIVING)
}

export function recordQuarantined(attemptId: string, metadata: QuarantineMetadata, client: AttemptClient = prisma): Promise<UploadAttempt> {
  if (
    metadata.actualSizeBytes < 0 ||
    metadata.actualSizeBytes > MAX_UPLOAD_BYTES ||
    !SHA256_PATTERN.test(metadata.checksumSha256)
  ) {
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Quarantine size or checksum metadata is invalid.")
  }
  requireOpaqueStorageKey(metadata.objectKey)
  return transition(client, attemptId, UploadStatus.RECEIVING, UploadStatus.QUARANTINED, {
    quarantineProvider: metadata.provider,
    quarantineBucket: metadata.bucket,
    quarantineObjectKey: metadata.objectKey,
    quarantineObjectVersionId: metadata.objectVersionId ?? null,
    quarantineEtag: metadata.etag ?? null,
    actualSizeBytes: BigInt(metadata.actualSizeBytes),
    checksumSha256: metadata.checksumSha256,
    quarantinedAt: metadata.quarantinedAt,
    cleanupStatus: UploadCleanupStatus.PENDING,
  })
}

export function beginValidation(attemptId: string, client: AttemptClient = prisma): Promise<UploadAttempt> {
  return transition(client, attemptId, UploadStatus.QUARANTINED, UploadStatus.VALIDATING)
}

export function recordValidated(attemptId: string, validatedAt: Date, client: AttemptClient = prisma): Promise<UploadAttempt> {
  return transition(client, attemptId, UploadStatus.VALIDATING, UploadStatus.VALIDATED, { validatedAt })
}

export function beginScanning(attemptId: string, client: AttemptClient = prisma): Promise<UploadAttempt> {
  return transition(client, attemptId, UploadStatus.VALIDATED, UploadStatus.SCANNING, {
    malwareStatus: StoredObjectMalwareStatus.PENDING,
  })
}

export async function recordScannerResult(
  attemptId: string,
  result: MalwareScanResult,
  client: AttemptClient = prisma,
): Promise<UploadAttempt> {
  if (result.outcome === "CLEAN") {
    const updated = await client.uploadAttempt.updateMany({
      where: { id: attemptId, status: UploadStatus.SCANNING, malwareStatus: StoredObjectMalwareStatus.PENDING },
      data: { malwareStatus: StoredObjectMalwareStatus.CLEAN, scannedAt: result.scannedAt },
    })
    if (updated.count !== 1) throw new UploadLifecycleError("CONFLICT", "The scan result cannot be recorded in the current state.")
    const attempt = await client.uploadAttempt.findUnique({ where: { id: attemptId } })
    if (!attempt) throw new UploadLifecycleError("CONFLICT", "The upload attempt is no longer available.")
    return attempt
  }

  const infected = result.outcome === "INFECTED"
  return transition(client, attemptId, UploadStatus.SCANNING, UploadStatus.FAILED, {
    malwareStatus: infected ? StoredObjectMalwareStatus.INFECTED : StoredObjectMalwareStatus.ERROR,
    scannedAt: result.scannedAt,
    failureStage: UploadFailureStage.SCAN,
    failureCategory: infected ? UploadFailureCategory.SCAN_INFECTED : UploadFailureCategory.SCAN_ERROR,
    cleanupStatus: UploadCleanupStatus.PENDING,
    expiresAt: new Date(result.scannedAt.getTime() + (infected ? SUSPECT_QUARANTINE_RETENTION_MS : ORDINARY_QUARANTINE_RETENTION_MS)),
  })
}

export async function beginPromotion(attemptId: string, client: AttemptClient = prisma): Promise<UploadAttempt> {
  const attempt = await client.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.status !== UploadStatus.SCANNING || attempt.malwareStatus !== StoredObjectMalwareStatus.CLEAN) {
    throw new UploadLifecycleError("SCAN_UNAVAILABLE", "Promotion requires a real clean scanner result.", UploadFailureCategory.SCAN_UNAVAILABLE)
  }
  return transition(client, attemptId, UploadStatus.SCANNING, UploadStatus.PROMOTING)
}

/**
 * Persists durable identity only after promotion metadata is fetched and
 * verified. The object stays PENDING; a later owner-link transaction is the
 * only place allowed to make it AVAILABLE.
 */
export async function recordVerifiedPromotion(
  attemptId: string,
  metadata: VerifiedPromotionMetadata,
  database: LifecycleDatabase = prisma,
): Promise<UploadAttempt> {
  if (!metadata.providerVerified || !metadata.encryptionVerified) {
    throw new UploadLifecycleError("PROMOTION_NOT_VERIFIED", "Provider and encryption metadata must be verified.")
  }
  if (!SHA256_PATTERN.test(metadata.checksumSha256) || metadata.sizeBytes < 0) {
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Promoted object size or checksum metadata is invalid.")
  }

  return database.$transaction(async (tx) => {
    const attempt = await tx.uploadAttempt.findUnique({ where: { id: attemptId } })
    if (
      !attempt ||
      attempt.status !== UploadStatus.PROMOTING ||
      attempt.malwareStatus !== StoredObjectMalwareStatus.CLEAN ||
      !attempt.validatedAt ||
      !attempt.scannedAt
    ) {
      throw new UploadLifecycleError("CONFLICT", "The upload attempt is not ready for promotion recording.")
    }
    if (
      attempt.checksumSha256 !== metadata.checksumSha256 ||
      attempt.actualSizeBytes !== BigInt(metadata.sizeBytes) ||
      attempt.plannedDurableObjectKey !== metadata.objectKey
    ) {
      throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Promoted object metadata does not match the verified upload.")
    }
    if (metadata.provider === "S3" && !metadata.encryptionKeyRef) {
      throw new UploadLifecycleError("PROMOTION_NOT_VERIFIED", "S3 promotion requires a verified encryption key reference.")
    }

    const storedObject = await tx.storedObject.create({
      data: {
        organizationId: attempt.organizationId,
        provider: metadata.provider,
        bucket: metadata.bucket,
        objectKey: metadata.objectKey,
        objectVersionId: metadata.objectVersionId ?? null,
        etag: metadata.etag ?? null,
        checksumSha256: metadata.checksumSha256,
        sizeBytes: BigInt(metadata.sizeBytes),
        mimeType: metadata.mimeType,
        originalFileName: null,
        encryptionKeyRef: metadata.encryptionKeyRef ?? null,
        lifecycleStatus: StoredObjectLifecycleStatus.PENDING,
        malwareStatus: attempt.malwareStatus,
        immutable: false,
        legalHold: false,
      },
    })
    const updated = await tx.uploadAttempt.updateMany({
      where: { id: attemptId, status: UploadStatus.PROMOTING, storedObjectId: null },
      data: { status: UploadStatus.PROMOTED, storedObjectId: storedObject.id, promotedAt: metadata.promotedAt },
    })
    if (updated.count !== 1) throw new UploadLifecycleError("CONFLICT", "Promotion was recorded concurrently.")
    const promoted = await tx.uploadAttempt.findUnique({ where: { id: attemptId } })
    if (!promoted) throw new UploadLifecycleError("CONFLICT", "The promoted upload attempt is unavailable.")
    return promoted
  })
}

export function beginLinking(attemptId: string, client: AttemptClient = prisma): Promise<UploadAttempt> {
  return transition(client, attemptId, UploadStatus.PROMOTED, UploadStatus.LINKING)
}

export function recordLinkedCleanupPending(attemptId: string, linkedAt: Date, client: AttemptClient = prisma): Promise<UploadAttempt> {
  return transition(client, attemptId, UploadStatus.LINKING, UploadStatus.LINKED_CLEANUP_PENDING, {
    linkedAt,
    cleanupStatus: UploadCleanupStatus.PENDING,
  })
}

export function recordCompleted(
  attemptId: string,
  current: typeof UploadStatus.LINKING | typeof UploadStatus.LINKED_CLEANUP_PENDING,
  completedAt: Date,
  client: AttemptClient = prisma,
): Promise<UploadAttempt> {
  return transition(client, attemptId, current, UploadStatus.COMPLETED, {
    linkedAt: current === UploadStatus.LINKING ? completedAt : undefined,
    cleanupStatus: UploadCleanupStatus.COMPLETED,
    cleanupCompletedAt: completedAt,
  })
}

export async function recordCleanupResult(
  attemptId: string,
  cleanupStatus: typeof UploadCleanupStatus.COMPLETED | typeof UploadCleanupStatus.FAILED,
  completedAt: Date,
  client: AttemptClient = prisma,
): Promise<UploadAttempt> {
  const result = await client.uploadAttempt.updateMany({
    where: {
      id: attemptId,
      cleanupStatus: UploadCleanupStatus.PENDING,
      status: { in: [UploadStatus.FAILED, UploadStatus.LINKED_CLEANUP_PENDING] },
    },
    data: {
      cleanupStatus,
      cleanupCompletedAt: cleanupStatus === UploadCleanupStatus.COMPLETED ? completedAt : null,
    },
  })
  if (result.count !== 1) throw new UploadLifecycleError("CONFLICT", "Cleanup cannot be recorded in the current state.")
  const attempt = await client.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt) throw new UploadLifecycleError("CONFLICT", "The upload attempt is no longer available.")
  return attempt
}

export async function markUploadFailed(
  attemptId: string,
  current: Exclude<UploadStatus, "COMPLETED" | "FAILED">,
  stage: UploadFailureStage,
  category: UploadFailureCategory,
  failedAt: Date,
  client: AttemptClient = prisma,
): Promise<UploadAttempt> {
  return transition(client, attemptId, current, UploadStatus.FAILED, {
    failureStage: stage,
    failureCategory: category,
    cleanupStatus: current === UploadStatus.INITIATED ? UploadCleanupStatus.NOT_REQUIRED : UploadCleanupStatus.PENDING,
    expiresAt: new Date(failedAt.getTime() + ORDINARY_QUARANTINE_RETENTION_MS),
  })
}

export function toSafeUploadSummary(attempt: UploadAttempt): SafeUploadSummary {
  return {
    attemptId: attempt.id,
    organizationId: attempt.organizationId,
    uploadKind: attempt.uploadKind,
    actorType: attempt.actorType,
    ownerType: attempt.intendedOwnerType,
    ownerId: attempt.intendedOwnerId,
    status: attempt.status,
    malwareStatus: attempt.malwareStatus,
    cleanupStatus: attempt.cleanupStatus,
    failureStage: attempt.failureStage ?? undefined,
    failureCategory: attempt.failureCategory ?? undefined,
    createdAt: attempt.createdAt,
    updatedAt: attempt.updatedAt,
  }
}
