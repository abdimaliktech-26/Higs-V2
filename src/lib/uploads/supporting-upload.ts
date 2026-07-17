import "server-only"

import { randomUUID } from "node:crypto"
import {
  Prisma,
  StoredObjectLifecycleStatus,
  UploadActorType,
  UploadCleanupStatus,
  UploadFailureCategory,
  UploadFailureStage,
  UploadKind,
  UploadOwnerType,
  UploadStatus,
  type UploadAttempt,
} from "@prisma/client"
import { prisma } from "../db"
import { storeFileFromStream } from "../storage"
import { createStorageAdapter, storageKeys, type StorageAdapter } from "../storage/index"
import { UploadLifecycleError, UploadValidationError } from "./errors"
import { beginLinking, buildInitiatedUploadData, hashIdempotencyKey, markUploadFailed } from "./lifecycle"
import { finishQuarantineCleanup, promoteVerifiedCleanUpload } from "./promotion"
import { getUploadValidationProfile } from "./profiles"
import { assertUploadRuntimeAvailable, receiveValidateAndBeginScan, UploadRuntimeUnavailableError } from "./receipt"
import { MAX_UPLOAD_BYTES } from "./types"
import { writeStrictPortalUploadAudit, writeStrictStaffUploadAudit } from "./audit"
import { notifySinglePortalUser } from "../portal/notifications"

const PORTAL_UPLOADABLE_STATUSES = ["PENDING", "NEEDS_REPLACEMENT"] as const

const COMPATIBILITY_EXTENSION: Record<string, string> = {
  "application/pdf": ".pdf",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": ".docx",
}

export interface StaffSupportingUploadIntentInput {
  title: string
  category?: string
  description?: string
  clientId?: string
  packetId?: string
}

export interface InitiateStaffSupportingUploadInput {
  organizationId: string
  staffUserId: string
  idempotencyKey: string
  file: File
  intent: StaffSupportingUploadIntentInput
}

export interface InitiatePortalUploadInput {
  organizationId: string
  clientId: string
  packetId?: string | null
  portalUserId: string
  requestId: string
  idempotencyKey: string
  originalFileName: string
  file: File
}

export interface SupportingUploadResult {
  attemptId: string
  status: UploadAttempt["status"]
  supportingDocumentId?: string
}

/** The quarantine object's content type is descriptive metadata only and is never trusted. */
function quarantineMimeType(uploadKind: UploadKind, declaredMimeType: string): string {
  const profile = getUploadValidationProfile(uploadKind)
  const declared = declaredMimeType.toLowerCase()
  for (const format of Object.values(profile.formats)) {
    if (format.mimeTypes.includes(declared)) return declared
  }
  return "application/octet-stream"
}

function compatibilityExtension(mimeType: string): string {
  const extension = COMPATIBILITY_EXTENSION[mimeType]
  if (!extension) throw new UploadLifecycleError("INTEGRITY_MISMATCH", "The validated upload type has no delivery mapping.")
  return extension
}

interface CreatedSupportingAttempt {
  attempt: UploadAttempt
  created: boolean
}

async function createSupportingAttemptAndIntent(input: {
  organizationId: string
  uploadKind: typeof UploadKind.STAFF_SUPPORTING | typeof UploadKind.PORTAL_REQUEST
  actor: { type: "STAFF"; staffUserId: string } | { type: "PORTAL"; portalUserId: string }
  actorIdentityId: string
  idempotencyKey: string
  file: File
  plannedDurableObjectKey: string
  supportingDocumentId: string
  artifactId: string
  parentResourceId?: string
  intent: Omit<Prisma.SupportingUploadIntentUncheckedCreateInput, "uploadAttemptId">
}): Promise<CreatedSupportingAttempt> {
  const idempotencyKeyHash = hashIdempotencyKey(input.idempotencyKey)
  const actorType = input.actor.type === "STAFF" ? UploadActorType.STAFF : UploadActorType.PORTAL
  const boundary = {
    organizationId: input.organizationId,
    actorType,
    actorIdentityId: input.actorIdentityId,
    uploadKind: input.uploadKind,
    idempotencyKeyHash,
  }
  const existing = await prisma.uploadAttempt.findUnique({
    where: { organizationId_actorType_actorIdentityId_uploadKind_idempotencyKeyHash: boundary },
  })
  if (existing) return { attempt: existing, created: false }

  const data = buildInitiatedUploadData({
    organizationId: input.organizationId,
    uploadKind: input.uploadKind,
    intendedOwnerType: UploadOwnerType.SUPPORTING_DOCUMENT,
    intendedOwnerId: input.supportingDocumentId,
    parentResourceId: input.parentResourceId,
    actor: input.actor,
    idempotencyKey: input.idempotencyKey,
    artifactId: input.artifactId,
    plannedDurableObjectKey: input.plannedDurableObjectKey,
    declaredMimeType: input.file.type,
    expectedSizeBytes: input.file.size,
  })

  try {
    const attempt = await prisma.$transaction(async (tx) => {
      const created = await tx.uploadAttempt.create({ data })
      await tx.supportingUploadIntent.create({ data: { ...input.intent, uploadAttemptId: created.id } })
      return created
    })
    return { attempt, created: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    const raced = await prisma.uploadAttempt.findUnique({
      where: { organizationId_actorType_actorIdentityId_uploadKind_idempotencyKeyHash: boundary },
    })
    if (!raced) throw error
    return { attempt: raced, created: false }
  }
}

function replayResult(attempt: UploadAttempt): SupportingUploadResult {
  if (attempt.status === UploadStatus.FAILED) throw new UploadLifecycleError("CONFLICT", "This upload key has already failed.")
  return {
    attemptId: attempt.id,
    status: attempt.status,
    supportingDocumentId: attempt.status === UploadStatus.COMPLETED ? attempt.intendedOwnerId : undefined,
  }
}

export async function initiateStaffSupportingUpload(
  input: InitiateStaffSupportingUploadInput,
  adapter: StorageAdapter = createStorageAdapter(),
): Promise<SupportingUploadResult> {
  assertUploadRuntimeAvailable()
  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("SIZE_LIMIT", "The upload exceeds the configured size limit.", UploadFailureCategory.SIZE_LIMIT)
  }
  const supportingDocumentId = randomUUID()
  const artifactId = randomUUID()
  const plannedDurableObjectKey = input.intent.clientId
    ? storageKeys.clientSupportingDocument({
        organizationId: input.organizationId,
        clientId: input.intent.clientId,
        supportingDocumentId,
        artifactId,
      })
    : storageKeys.organizationSupportingDocument({
        organizationId: input.organizationId,
        supportingDocumentId,
        artifactId,
      })
  const { attempt, created } = await createSupportingAttemptAndIntent({
    organizationId: input.organizationId,
    uploadKind: UploadKind.STAFF_SUPPORTING,
    actor: { type: "STAFF", staffUserId: input.staffUserId },
    actorIdentityId: input.staffUserId,
    idempotencyKey: input.idempotencyKey,
    file: input.file,
    plannedDurableObjectKey,
    supportingDocumentId,
    artifactId,
    intent: {
      organizationId: input.organizationId,
      supportingDocumentId,
      clientId: input.intent.clientId ?? null,
      packetId: input.intent.packetId ?? null,
      title: input.intent.title,
      category: input.intent.category ?? null,
      description: input.intent.description ?? null,
    },
  })
  if (!created) return replayResult(attempt)
  await receiveValidateAndBeginScan({
    attempt,
    file: input.file,
    adapter,
    quarantineMimeType: quarantineMimeType(UploadKind.STAFF_SUPPORTING, input.file.type),
  })
  return { attemptId: attempt.id, status: UploadStatus.SCANNING }
}

export async function initiatePortalUpload(
  input: InitiatePortalUploadInput,
  adapter: StorageAdapter = createStorageAdapter(),
): Promise<SupportingUploadResult> {
  assertUploadRuntimeAvailable()
  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("SIZE_LIMIT", "The upload exceeds the configured size limit.", UploadFailureCategory.SIZE_LIMIT)
  }
  const supportingDocumentId = randomUUID()
  const artifactId = randomUUID()
  const plannedDurableObjectKey = storageKeys.portalRequestUpload({
    organizationId: input.organizationId,
    clientId: input.clientId,
    requestId: input.requestId,
    supportingDocumentId,
    artifactId,
  })
  const { attempt, created } = await createSupportingAttemptAndIntent({
    organizationId: input.organizationId,
    uploadKind: UploadKind.PORTAL_REQUEST,
    actor: { type: "PORTAL", portalUserId: input.portalUserId },
    actorIdentityId: input.portalUserId,
    idempotencyKey: input.idempotencyKey,
    file: input.file,
    plannedDurableObjectKey,
    supportingDocumentId,
    artifactId,
    parentResourceId: input.requestId,
    intent: {
      organizationId: input.organizationId,
      supportingDocumentId,
      clientId: input.clientId,
      packetId: input.packetId ?? null,
      portalRequestId: input.requestId,
      originalFileName: input.originalFileName,
    },
  })
  if (!created) return replayResult(attempt)
  await receiveValidateAndBeginScan({
    attempt,
    file: input.file,
    adapter,
    quarantineMimeType: quarantineMimeType(UploadKind.PORTAL_REQUEST, input.file.type),
  })
  return { attemptId: attempt.id, status: UploadStatus.SCANNING }
}

interface PreparedCompletion {
  attempt: UploadAttempt
  promotedSize: number
  promotedMimeType: string
  compatibilityUrl: string
  compatibilityKey: string
}

/**
 * Shared promote/verify/compatibility phase for a clean supporting upload.
 * Callers must already have short-circuited terminal and resumable states;
 * this requires SCANNING + CLEAN plus the persisted validated MIME type.
 */
async function prepareSupportingCompletion(
  attempt: UploadAttempt,
  adapter: StorageAdapter,
  originalFileName: string | null,
): Promise<PreparedCompletion> {
  if (attempt.status !== UploadStatus.SCANNING || attempt.malwareStatus !== "CLEAN") {
    throw new UploadLifecycleError("SCAN_UNAVAILABLE", "The verified malware scan is not complete.")
  }
  const expectedMimeType = attempt.validatedMimeType
  if (!expectedMimeType) {
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "The validated upload type is unavailable.")
  }
  const extension = compatibilityExtension(expectedMimeType)
  const promotion = await promoteVerifiedCleanUpload(attempt, expectedMimeType, adapter)
  const promoted = promotion.promoted

  const compatibilityKey =
    attempt.uploadKind === UploadKind.PORTAL_REQUEST
      ? `portal-uploads/${attempt.organizationId}/${attempt.artifactId}${extension}`
      : `supporting/${attempt.organizationId}/${attempt.artifactId}${extension}`
  let compatibility
  try {
    const durable = await adapter.getObjectStream({ key: promoted.key, location: "durable", versionId: promoted.versionId })
    compatibility = await storeFileFromStream(compatibilityKey, durable.stream, expectedMimeType, originalFileName ?? "document")
  } catch (error) {
    await markUploadFailed(attempt.id, UploadStatus.PROMOTED, UploadFailureStage.LINKAGE, UploadFailureCategory.STORAGE_FAILURE, new Date()).catch(() => undefined)
    throw error
  }
  await beginLinking(attempt.id)
  return {
    attempt: promotion.attempt,
    promotedSize: promoted.size,
    promotedMimeType: promoted.mimeType,
    compatibilityUrl: compatibility.url,
    compatibilityKey: compatibility.key,
  }
}

async function markLinkageFailed(attemptId: string, error: unknown): Promise<void> {
  await markUploadFailed(
    attemptId,
    UploadStatus.LINKING,
    UploadFailureStage.LINKAGE,
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
      ? UploadFailureCategory.CONFLICT
      : error instanceof UploadLifecycleError && error.failureCategory
        ? error.failureCategory
        : UploadFailureCategory.DATABASE_FAILURE,
    new Date(),
  ).catch(() => undefined)
}

async function finishSupportingCompletion(
  attemptId: string,
  ownerId: string,
  adapter: StorageAdapter,
): Promise<SupportingUploadResult> {
  const attempt = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: attemptId } })
  try {
    await finishQuarantineCleanup(attempt, adapter)
    return { attemptId, status: UploadStatus.COMPLETED, supportingDocumentId: ownerId }
  } catch {
    return { attemptId, status: UploadStatus.LINKED_CLEANUP_PENDING, supportingDocumentId: ownerId }
  }
}

export async function completeStaffSupportingUpload(
  attemptId: string,
  staffUserId: string,
  adapter: StorageAdapter = createStorageAdapter(),
): Promise<SupportingUploadResult> {
  assertUploadRuntimeAvailable()
  const attempt = await prisma.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (
    !attempt ||
    attempt.actorType !== UploadActorType.STAFF ||
    attempt.staffUserId !== staffUserId ||
    attempt.uploadKind !== UploadKind.STAFF_SUPPORTING
  ) {
    throw new UploadLifecycleError("CONFLICT", "Upload not found.")
  }
  if (attempt.status === UploadStatus.COMPLETED) {
    return { attemptId, status: attempt.status, supportingDocumentId: attempt.intendedOwnerId }
  }
  if (attempt.status === UploadStatus.LINKED_CLEANUP_PENDING) {
    return finishSupportingCompletion(attemptId, attempt.intendedOwnerId, adapter)
  }

  const prepared = await prepareSupportingCompletion(attempt, adapter, null)

  let ownerId: string
  try {
    ownerId = await prisma.$transaction(async (tx) => {
      const current = await tx.uploadAttempt.findUnique({
        where: { id: attemptId },
        include: { supportingIntent: true, storedObject: true },
      })
      const intent = current?.supportingIntent
      const storedObject = current?.storedObject
      if (
        !current ||
        !intent ||
        !intent.title ||
        !storedObject ||
        current.status !== UploadStatus.LINKING ||
        storedObject.lifecycleStatus !== StoredObjectLifecycleStatus.PENDING
      ) {
        throw new UploadLifecycleError("CONFLICT", "The supporting upload cannot be linked in its current state.")
      }
      const created = await tx.supportingDocument.create({
        data: {
          id: intent.supportingDocumentId,
          organizationId: current.organizationId,
          title: intent.title,
          category: intent.category ?? "supporting",
          description: intent.description,
          clientId: intent.clientId,
          packetId: intent.packetId,
          fileUrl: prepared.compatibilityUrl,
          fileKey: prepared.compatibilityKey,
          fileSize: prepared.promotedSize,
          mimeType: prepared.promotedMimeType,
          uploadedById: staffUserId,
          storedObjectId: storedObject.id,
        },
      })
      const storageUpdate = await tx.storedObject.updateMany({
        where: { id: storedObject.id, lifecycleStatus: StoredObjectLifecycleStatus.PENDING },
        data: { lifecycleStatus: StoredObjectLifecycleStatus.AVAILABLE },
      })
      if (storageUpdate.count !== 1) throw new UploadLifecycleError("CONFLICT", "Stored object linkage changed concurrently.")
      await writeStrictStaffUploadAudit(tx, {
        organizationId: current.organizationId,
        staffUserId,
        uploadAttemptId: current.id,
        storedObjectId: storedObject.id,
        ownerType: UploadOwnerType.SUPPORTING_DOCUMENT,
        ownerId: created.id,
        sizeBytes: prepared.promotedSize,
        mimeType: prepared.promotedMimeType,
      })
      const attemptUpdate = await tx.uploadAttempt.updateMany({
        where: { id: current.id, status: UploadStatus.LINKING },
        data: { status: UploadStatus.LINKED_CLEANUP_PENDING, linkedAt: new Date(), cleanupStatus: UploadCleanupStatus.PENDING },
      })
      if (attemptUpdate.count !== 1) throw new UploadLifecycleError("CONFLICT", "Upload linkage changed concurrently.")
      return created.id
    })
  } catch (error) {
    await markLinkageFailed(attemptId, error)
    throw error
  }

  return finishSupportingCompletion(attemptId, ownerId, adapter)
}

export interface PortalCompletionEvidence {
  supportingDocumentId: string
  requestStatus: "SUBMITTED"
}

export async function completePortalUpload(
  attemptId: string,
  portalUserId: string,
  adapter: StorageAdapter = createStorageAdapter(),
): Promise<SupportingUploadResult> {
  assertUploadRuntimeAvailable()
  const attempt = await prisma.uploadAttempt.findUnique({
    where: { id: attemptId },
    include: { supportingIntent: true },
  })
  if (
    !attempt ||
    attempt.actorType !== UploadActorType.PORTAL ||
    attempt.portalUserId !== portalUserId ||
    attempt.uploadKind !== UploadKind.PORTAL_REQUEST
  ) {
    throw new UploadLifecycleError("CONFLICT", "Upload not found.")
  }
  if (attempt.status === UploadStatus.COMPLETED) {
    return { attemptId, status: attempt.status, supportingDocumentId: attempt.intendedOwnerId }
  }
  if (attempt.status === UploadStatus.LINKED_CLEANUP_PENDING) {
    return finishSupportingCompletion(attemptId, attempt.intendedOwnerId, adapter)
  }
  const intent = attempt.supportingIntent
  if (!intent?.portalRequestId || !intent.clientId) {
    throw new UploadLifecycleError("CONFLICT", "The portal upload intent is unavailable.")
  }

  const prepared = await prepareSupportingCompletion(attempt, adapter, intent.originalFileName)

  let ownerId: string
  try {
    ownerId = await prisma.$transaction(async (tx) => {
      const current = await tx.uploadAttempt.findUnique({
        where: { id: attemptId },
        include: { supportingIntent: true, storedObject: true },
      })
      const currentIntent = current?.supportingIntent
      const storedObject = current?.storedObject
      if (
        !current ||
        !currentIntent?.portalRequestId ||
        !storedObject ||
        current.status !== UploadStatus.LINKING ||
        storedObject.lifecycleStatus !== StoredObjectLifecycleStatus.PENDING
      ) {
        throw new UploadLifecycleError("CONFLICT", "The portal upload cannot be linked in its current state.")
      }
      // The request row remains the source of truth for organization, client,
      // packet, title, and category — exactly as the legacy synchronous route.
      const request = await tx.portalDocumentRequest.findUnique({ where: { id: currentIntent.portalRequestId } })
      if (
        !request ||
        request.organizationId !== current.organizationId ||
        request.clientId !== currentIntent.clientId
      ) {
        throw new UploadLifecycleError("CONFLICT", "The document request is no longer available.", UploadFailureCategory.CONFLICT)
      }
      if (!PORTAL_UPLOADABLE_STATUSES.includes(request.status as (typeof PORTAL_UPLOADABLE_STATUSES)[number])) {
        throw new UploadLifecycleError("CONFLICT", "This request cannot accept an upload right now.", UploadFailureCategory.CONFLICT)
      }
      const eventType = request.status === "NEEDS_REPLACEMENT" ? "RESUBMITTED" : "UPLOADED"
      // Conditional update prevents a race where two uploads for the same
      // request both complete — only the first commits the SUBMITTED
      // transition; a concurrent second completion sees count !== 1 and aborts.
      const requestUpdate = await tx.portalDocumentRequest.updateMany({
        where: { id: request.id, status: { in: [...PORTAL_UPLOADABLE_STATUSES] } },
        data: { status: "SUBMITTED" },
      })
      if (requestUpdate.count !== 1) {
        throw new UploadLifecycleError("CONFLICT", "This request cannot accept an upload right now.", UploadFailureCategory.CONFLICT)
      }
      const created = await tx.supportingDocument.create({
        data: {
          id: currentIntent.supportingDocumentId,
          organizationId: request.organizationId,
          clientId: request.clientId,
          packetId: request.packetId,
          title: request.title,
          category: request.category.toLowerCase(),
          fileUrl: prepared.compatibilityUrl,
          fileKey: prepared.compatibilityKey,
          fileSize: prepared.promotedSize,
          mimeType: prepared.promotedMimeType,
          originalFileName: currentIntent.originalFileName,
          portalRequestId: request.id,
          uploadedByPortalUserId: portalUserId,
          status: "active",
          reviewStatus: "PENDING_REVIEW",
          storedObjectId: storedObject.id,
        },
      })
      await tx.portalDocumentTimelineEvent.create({
        data: {
          requestId: request.id,
          eventType,
          supportingDocumentId: created.id,
          createdByPortalUserId: portalUserId,
        },
      })
      await writeStrictPortalUploadAudit(tx, {
        organizationId: request.organizationId,
        portalUserId,
        clientId: request.clientId,
        uploadAttemptId: current.id,
        storedObjectId: storedObject.id,
        ownerType: UploadOwnerType.SUPPORTING_DOCUMENT,
        ownerId: created.id,
        sizeBytes: prepared.promotedSize,
        mimeType: prepared.promotedMimeType,
      })
      await notifySinglePortalUser(portalUserId, {
        organizationId: request.organizationId,
        clientId: request.clientId,
        type: "upload_received",
        title: "Upload received",
        message: "We received your uploaded document. It's now pending review.",
        link: `/portal/upload?client=${request.clientId}&request=${request.id}`,
        metadata: { requestId: request.id, clientId: request.clientId, event: "upload_received" },
      }, tx)
      const storageUpdate = await tx.storedObject.updateMany({
        where: { id: storedObject.id, lifecycleStatus: StoredObjectLifecycleStatus.PENDING },
        data: { lifecycleStatus: StoredObjectLifecycleStatus.AVAILABLE },
      })
      if (storageUpdate.count !== 1) throw new UploadLifecycleError("CONFLICT", "Stored object linkage changed concurrently.")
      const attemptUpdate = await tx.uploadAttempt.updateMany({
        where: { id: current.id, status: UploadStatus.LINKING },
        data: { status: UploadStatus.LINKED_CLEANUP_PENDING, linkedAt: new Date(), cleanupStatus: UploadCleanupStatus.PENDING },
      })
      if (attemptUpdate.count !== 1) throw new UploadLifecycleError("CONFLICT", "Upload linkage changed concurrently.")
      return created.id
    })
  } catch (error) {
    await markLinkageFailed(attemptId, error)
    throw error
  }

  return finishSupportingCompletion(attemptId, ownerId, adapter)
}
