import {
  StoredObjectLifecycleStatus,
  StoredObjectMalwareStatus,
  UploadCleanupStatus,
  UploadOwnerType,
  UploadStatus,
  type StorageProvider,
} from "@prisma/client"
import { prisma } from "../db"

export type UploadReconciliationFindingCategory =
  | "STALE_INITIATED_OR_RECEIVING"
  | "STALE_QUARANTINE_OBJECT"
  | "PROMOTION_STUCK"
  | "DURABLE_OBJECT_WITHOUT_STORED_OBJECT"
  | "PENDING_STORED_OBJECT_WITHOUT_OWNER"
  | "AVAILABLE_STORED_OBJECT_WITHOUT_OWNER"
  | "OWNER_REFERENCES_UNAVAILABLE_STORAGE"
  | "OWNER_NOT_DURABLY_RESOLVABLE"
  | "PROVIDER_OBJECT_MISSING"
  | "CLEANUP_PENDING"
  | "LINKED_ATTEMPT_MISSING_EXPECTED_OWNER"
  | "LEGACY_PLACEHOLDER"

export interface UploadReconciliationFinding {
  category: UploadReconciliationFindingCategory
  resourceType: "UPLOAD_ATTEMPT" | "STORED_OBJECT" | "PDF_VERSION" | "DOCUMENT_TEMPLATE" | "SUPPORTING_DOCUMENT"
  resourceId: string
  organizationId?: string
}

export interface StoredObjectProbeLocator {
  provider: StorageProvider
  bucket: string
  key: string
  versionId?: string
}

export interface UploadReconciliationProbes {
  durableKeyExists?(key: string): Promise<boolean>
  storedObjectExists?(locator: StoredObjectProbeLocator): Promise<boolean>
}

export interface UploadReconciliationOptions {
  now?: Date
  staleAttemptMs?: number
  probes?: UploadReconciliationProbes
}

type ReconciliationClient = Pick<
  typeof prisma,
  "uploadAttempt" | "storedObject" | "pdfVersion" | "documentTemplate" | "supportingDocument"
>

/**
 * Produces an opaque, bounded, dry-run report. It intentionally exposes no
 * object key, bucket, filename, provider error, or PHI and performs no write or
 * deletion.
 */
export async function generateUploadReconciliationReport(
  client: ReconciliationClient = prisma,
  options: UploadReconciliationOptions = {},
): Promise<UploadReconciliationFinding[]> {
  const now = options.now ?? new Date()
  const staleBefore = new Date(now.getTime() - (options.staleAttemptMs ?? 60 * 60 * 1000))
  const [attempts, storedObjects, legacyPdfVersions] = await Promise.all([
    client.uploadAttempt.findMany({
      select: {
        id: true,
        organizationId: true,
        status: true,
        cleanupStatus: true,
        expiresAt: true,
        updatedAt: true,
        intendedOwnerType: true,
        intendedOwnerId: true,
        plannedDurableObjectKey: true,
        storedObjectId: true,
      },
    }),
    client.storedObject.findMany({
      select: {
        id: true,
        organizationId: true,
        provider: true,
        bucket: true,
        objectKey: true,
        objectVersionId: true,
        lifecycleStatus: true,
        documentTemplate: { select: { id: true } },
        pdfVersion: { select: { id: true } },
        supportingDocument: { select: { id: true } },
      },
    }),
    client.pdfVersion.findMany({ where: { storedObjectId: null }, select: { id: true } }),
  ])

  const findings: UploadReconciliationFinding[] = []
  const linkedTemplateIds = attempts
    .filter((attempt) => isLinked(attempt.status) && attempt.intendedOwnerType === UploadOwnerType.DOCUMENT_TEMPLATE)
    .map((attempt) => attempt.intendedOwnerId)
  const linkedSupportingIds = attempts
    .filter((attempt) => isLinked(attempt.status) && attempt.intendedOwnerType === UploadOwnerType.SUPPORTING_DOCUMENT)
    .map((attempt) => attempt.intendedOwnerId)
  const [templates, supportingDocuments] = await Promise.all([
    linkedTemplateIds.length
      ? client.documentTemplate.findMany({ where: { id: { in: linkedTemplateIds } }, select: { id: true, storedObjectId: true } })
      : Promise.resolve([]),
    linkedSupportingIds.length
      ? client.supportingDocument.findMany({ where: { id: { in: linkedSupportingIds } }, select: { id: true, storedObjectId: true } })
      : Promise.resolve([]),
  ])
  const ownerLinks = new Map<string, string | null>([
    ...templates.map((owner) => [`DOCUMENT_TEMPLATE:${owner.id}`, owner.storedObjectId] as const),
    ...supportingDocuments.map((owner) => [`SUPPORTING_DOCUMENT:${owner.id}`, owner.storedObjectId] as const),
  ])

  for (const attempt of attempts) {
    const base = { resourceType: "UPLOAD_ATTEMPT" as const, resourceId: attempt.id, organizationId: attempt.organizationId }
    if (
      (attempt.status === UploadStatus.INITIATED || attempt.status === UploadStatus.RECEIVING) &&
      attempt.updatedAt < staleBefore
    ) {
      findings.push({ category: "STALE_INITIATED_OR_RECEIVING", ...base })
    }
    const quarantineStatuses = new Set<UploadStatus>([
      UploadStatus.QUARANTINED,
      UploadStatus.VALIDATING,
      UploadStatus.VALIDATED,
      UploadStatus.SCANNING,
    ])
    if (quarantineStatuses.has(attempt.status) && attempt.expiresAt <= now) {
      findings.push({ category: "STALE_QUARANTINE_OBJECT", ...base })
    }
    if (attempt.status === UploadStatus.PROMOTING && attempt.updatedAt < staleBefore) {
      findings.push({ category: "PROMOTION_STUCK", ...base })
      if (!attempt.storedObjectId && (await options.probes?.durableKeyExists?.(attempt.plannedDurableObjectKey))) {
        findings.push({ category: "DURABLE_OBJECT_WITHOUT_STORED_OBJECT", ...base })
      }
    }
    if (attempt.cleanupStatus === UploadCleanupStatus.PENDING) findings.push({ category: "CLEANUP_PENDING", ...base })
    if (isLinked(attempt.status)) {
      const linkedStoredObjectId = ownerLinks.get(`${attempt.intendedOwnerType}:${attempt.intendedOwnerId}`)
      if (!linkedStoredObjectId || linkedStoredObjectId !== attempt.storedObjectId) {
        findings.push({ category: "LINKED_ATTEMPT_MISSING_EXPECTED_OWNER", ...base })
      }
    }
  }

  for (const object of storedObjects) {
    const ownerId = object.documentTemplate?.id ?? object.pdfVersion?.id ?? object.supportingDocument?.id
    const base = { resourceType: "STORED_OBJECT" as const, resourceId: object.id, organizationId: object.organizationId }
    if (!ownerId && object.lifecycleStatus === StoredObjectLifecycleStatus.PENDING) {
      findings.push({ category: "PENDING_STORED_OBJECT_WITHOUT_OWNER", ...base })
    }
    if (!ownerId && object.lifecycleStatus === StoredObjectLifecycleStatus.AVAILABLE) {
      findings.push({ category: "AVAILABLE_STORED_OBJECT_WITHOUT_OWNER", ...base })
    }
    const unavailableStatuses = new Set<StoredObjectLifecycleStatus>([
      StoredObjectLifecycleStatus.FAILED,
      StoredObjectLifecycleStatus.DELETION_PENDING,
      StoredObjectLifecycleStatus.DELETED,
    ])
    if (ownerId && unavailableStatuses.has(object.lifecycleStatus)) {
      findings.push({ category: "OWNER_REFERENCES_UNAVAILABLE_STORAGE", ...base })
    }
    if (
      options.probes?.storedObjectExists &&
      !(await options.probes.storedObjectExists({
        provider: object.provider,
        bucket: object.bucket,
        key: object.objectKey,
        versionId: object.objectVersionId ?? undefined,
      }))
    ) {
      findings.push({ category: "PROVIDER_OBJECT_MISSING", ...base })
    }
  }

  for (const pdfVersion of legacyPdfVersions) {
    findings.push({ category: "LEGACY_PLACEHOLDER", resourceType: "PDF_VERSION", resourceId: pdfVersion.id })
  }

  // PR-5C gate measurement: owner rows with a legacy file that do not yet
  // resolve to a servable durable object. This is the population PR-5C.2
  // backfill must drain to zero before PR-5C.3 compatibility retirement can
  // be considered. pdf_version placeholders are tracked separately above.
  const [templateOwners, supportingOwners] = await Promise.all([
    client.documentTemplate.findMany({
      select: { id: true, organizationId: true, fileKey: true, storedObject: { select: durableResolutionFields } },
    }),
    client.supportingDocument.findMany({
      select: { id: true, organizationId: true, fileKey: true, storedObject: { select: durableResolutionFields } },
    }),
  ])
  for (const owner of templateOwners) {
    if (owner.fileKey && !isDurablyResolvable(owner.storedObject)) {
      findings.push({ category: "OWNER_NOT_DURABLY_RESOLVABLE", resourceType: "DOCUMENT_TEMPLATE", resourceId: owner.id, organizationId: owner.organizationId })
    }
  }
  for (const owner of supportingOwners) {
    if (owner.fileKey && !isDurablyResolvable(owner.storedObject)) {
      findings.push({ category: "OWNER_NOT_DURABLY_RESOLVABLE", resourceType: "SUPPORTING_DOCUMENT", resourceId: owner.id, organizationId: owner.organizationId })
    }
  }

  return findings.sort((left, right) =>
    `${left.category}:${left.resourceType}:${left.resourceId}`.localeCompare(`${right.category}:${right.resourceType}:${right.resourceId}`),
  )
}

function isLinked(status: UploadStatus): boolean {
  return status === UploadStatus.LINKED_CLEANUP_PENDING || status === UploadStatus.COMPLETED
}

const durableResolutionFields = {
  provider: true,
  lifecycleStatus: true,
  malwareStatus: true,
  objectVersionId: true,
} as const

interface DurableResolutionShape {
  provider: StorageProvider
  lifecycleStatus: StoredObjectLifecycleStatus
  malwareStatus: StoredObjectMalwareStatus
  objectVersionId: string | null
}

/** Mirrors the PR-5C.1 reader qualification: exact-version S3, AVAILABLE, CLEAN or NOT_SCANNED. */
function isDurablyResolvable(object: DurableResolutionShape | null): boolean {
  return Boolean(
    object &&
      object.provider === "S3" &&
      object.lifecycleStatus === StoredObjectLifecycleStatus.AVAILABLE &&
      (object.malwareStatus === StoredObjectMalwareStatus.CLEAN || object.malwareStatus === StoredObjectMalwareStatus.NOT_SCANNED) &&
      object.objectVersionId,
  )
}
