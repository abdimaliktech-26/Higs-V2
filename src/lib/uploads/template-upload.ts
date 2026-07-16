import "server-only"

import { randomUUID } from "node:crypto"
import { extname } from "node:path"
import { Readable } from "node:stream"
import {
  AuditAction,
  Prisma,
  StorageProvider,
  StoredObjectLifecycleStatus,
  UploadActorType,
  UploadCleanupStatus,
  UploadFailureCategory,
  UploadFailureStage,
  UploadKind,
  UploadOwnerType,
  UploadScannerProvider,
  UploadStatus,
  type UploadAttempt,
} from "@prisma/client"
import { prisma } from "../db"
import { storeFileFromStream } from "../storage"
import { createStorageAdapter, readStorageConfiguration, storageKeys, type StorageAdapter } from "../storage/index"
import { readUploadScannerConfiguration } from "./config"
import { UploadLifecycleError, UploadValidationError } from "./errors"
import {
  beginEventDrivenScanning,
  beginLinking,
  beginPromotion,
  beginReceiving,
  buildInitiatedUploadData,
  hashIdempotencyKey,
  markUploadFailed,
  recordCompleted,
  recordQuarantined,
  recordValidated,
  recordVerifiedPromotion,
  beginValidation,
} from "./lifecycle"
import { getUploadValidationProfile } from "./profiles"
import { withUploadSpool } from "./stream"
import { MAX_UPLOAD_BYTES } from "./types"
import { validateUpload } from "./validation"
import { writeStrictStaffUploadAudit } from "./audit"

export interface TemplateUploadIntentInput {
  name: string
  description?: string
  formType: string
  program?: string
  previousVersionId?: string
}

export interface InitiateTemplateUploadInput {
  organizationId: string
  staffUserId: string
  idempotencyKey: string
  file: File
  intent: TemplateUploadIntentInput
}

export interface TemplateUploadResult {
  attemptId: string
  status: UploadAttempt["status"]
  templateId?: string
  version?: number
}

export class TemplateUploadUnavailableError extends Error {
  constructor() {
    super("Secure template uploads are temporarily unavailable.")
    this.name = "TemplateUploadUnavailableError"
  }
}

/** Active migrated writers require the complete S3 + GuardDuty operating gate in every environment. */
export function assertTemplateUploadRuntimeAvailable(): void {
  const storage = readStorageConfiguration()
  const scanner = readUploadScannerConfiguration()
  if (
    storage.provider !== "s3" ||
    !storage.region ||
    !storage.durableBucket ||
    !storage.quarantineBucket ||
    !storage.kmsKeyArn ||
    scanner.provider !== "guardduty-s3" ||
    scanner.errors.length > 0 ||
    !scanner.operationallyApproved ||
    !scanner.platformLimitsVerified
  ) {
    throw new TemplateUploadUnavailableError()
  }
}

function asDatabaseProvider(provider: StorageAdapter["provider"]): StorageProvider {
  if (provider !== "s3") throw new TemplateUploadUnavailableError()
  return StorageProvider.S3
}

async function createAttemptAndIntent(input: InitiateTemplateUploadInput): Promise<{ attempt: UploadAttempt; created: boolean }> {
  const uploadKind = input.intent.previousVersionId ? UploadKind.TEMPLATE_VERSION : UploadKind.TEMPLATE
  const idempotencyKeyHash = hashIdempotencyKey(input.idempotencyKey)
  const existing = await prisma.uploadAttempt.findUnique({
    where: {
      organizationId_actorType_actorIdentityId_uploadKind_idempotencyKeyHash: {
        organizationId: input.organizationId,
        actorType: UploadActorType.STAFF,
        actorIdentityId: input.staffUserId,
        uploadKind,
        idempotencyKeyHash,
      },
    },
  })
  if (existing) return { attempt: existing, created: false }

  const documentTemplateId = randomUUID()
  const artifactId = randomUUID()
  const plannedDurableObjectKey = storageKeys.templateSource({
    organizationId: input.organizationId,
    documentTemplateId,
    artifactId,
  })
  const data = buildInitiatedUploadData({
    organizationId: input.organizationId,
    uploadKind,
    intendedOwnerType: UploadOwnerType.DOCUMENT_TEMPLATE,
    intendedOwnerId: documentTemplateId,
    parentResourceId: input.intent.previousVersionId,
    actor: { type: "STAFF", staffUserId: input.staffUserId },
    idempotencyKey: input.idempotencyKey,
    artifactId,
    plannedDurableObjectKey,
    declaredMimeType: input.file.type,
    expectedSizeBytes: input.file.size,
  })

  try {
    const attempt = await prisma.$transaction(async (tx) => {
      const created = await tx.uploadAttempt.create({ data })
      await tx.templateUploadIntent.create({
        data: {
          organizationId: input.organizationId,
          uploadAttemptId: created.id,
          documentTemplateId,
          previousVersionId: input.intent.previousVersionId ?? null,
          name: input.intent.name,
          description: input.intent.description ?? null,
          formType: input.intent.formType,
          program: input.intent.program ?? null,
        },
      })
      return created
    })
    return { attempt, created: true }
  } catch (error) {
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") throw error
    const raced = await prisma.uploadAttempt.findUnique({
      where: {
        organizationId_actorType_actorIdentityId_uploadKind_idempotencyKeyHash: {
          organizationId: input.organizationId,
          actorType: UploadActorType.STAFF,
          actorIdentityId: input.staffUserId,
          uploadKind,
          idempotencyKeyHash,
        },
      },
    })
    if (!raced) throw error
    return { attempt: raced, created: false }
  }
}

function safeFailure(error: unknown): { stage: UploadFailureStage; category: UploadFailureCategory } {
  if (error instanceof UploadValidationError) {
    return { stage: UploadFailureStage.VALIDATION, category: error.failureCategory ?? UploadFailureCategory.MALFORMED_CONTENT }
  }
  return { stage: UploadFailureStage.QUARANTINE, category: UploadFailureCategory.STORAGE_FAILURE }
}

export async function initiateTemplateUpload(
  input: InitiateTemplateUploadInput,
  adapter: StorageAdapter = createStorageAdapter(),
): Promise<TemplateUploadResult> {
  assertTemplateUploadRuntimeAvailable()
  if (input.file.size > MAX_UPLOAD_BYTES) {
    throw new UploadValidationError("SIZE_LIMIT", "The upload exceeds the configured size limit.", UploadFailureCategory.SIZE_LIMIT)
  }
  const { attempt, created } = await createAttemptAndIntent(input)
  if (!created) {
    if (attempt.status === UploadStatus.FAILED) throw new UploadLifecycleError("CONFLICT", "This upload key has already failed.")
    return {
      attemptId: attempt.id,
      status: attempt.status,
      templateId: attempt.status === UploadStatus.COMPLETED ? attempt.intendedOwnerId : undefined,
    }
  }

  let current: UploadStatus = UploadStatus.INITIATED
  try {
    await beginReceiving(attempt.id)
    current = UploadStatus.RECEIVING
    const quarantineKey = storageKeys.quarantine({
      organizationId: input.organizationId,
      uploadAttemptId: attempt.id,
      artifactId: attempt.artifactId,
    })
    const profile = getUploadValidationProfile(attempt.uploadKind)
    await withUploadSpool(
      {
        stream: Readable.fromWeb(input.file.stream() as never),
        maxBytes: profile.maxBytes,
        declaredSize: input.file.size,
      },
      async (spool) => {
        const quarantined = await adapter.putObject({
          key: quarantineKey,
          location: "quarantine",
          body: spool.openStream(),
          expectedContentLength: spool.size,
          mimeType: "application/pdf",
          checksumSha256: spool.checksumSha256,
          encryption: { mode: "sse-kms" },
          preconditions: { ifNoneMatch: true },
          metadata: { uploadAttemptId: attempt.id },
        })
        if (!quarantined.versionId || !quarantined.etag) {
          throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Quarantine storage did not return version-bound identity.")
        }
        await recordQuarantined(attempt.id, {
          provider: asDatabaseProvider(adapter.provider),
          bucket: quarantined.bucket,
          objectKey: quarantined.key,
          objectVersionId: quarantined.versionId,
          etag: quarantined.etag,
          actualSizeBytes: spool.size,
          checksumSha256: spool.checksumSha256,
          quarantinedAt: new Date(),
        })
        current = UploadStatus.QUARANTINED
        await beginValidation(attempt.id)
        current = UploadStatus.VALIDATING
        await validateUpload({
          source: spool,
          extension: extname(input.file.name),
          declaredMimeType: input.file.type,
          policy: profile,
        })
        await recordValidated(attempt.id, new Date())
        current = UploadStatus.VALIDATED
      },
    )
    await beginEventDrivenScanning(attempt.id, UploadScannerProvider.GUARDDUTY_S3, new Date())
    return { attemptId: attempt.id, status: UploadStatus.SCANNING }
  } catch (error) {
    const failure = safeFailure(error)
    await markUploadFailed(attempt.id, current, failure.stage, failure.category, new Date()).catch(() => undefined)
    throw error
  }
}

export async function cloneTemplateFieldsAndConditions(
  tx: Prisma.TransactionClient,
  previousId: string,
  createdId: string,
  organizationId: string,
): Promise<void> {
  const priorFields = await tx.documentTemplateField.findMany({ where: { documentTemplateId: previousId } })
  if (priorFields.length === 0) return
  await tx.documentTemplateField.createMany({
    data: priorFields.map((field) => ({
      organizationId: field.organizationId,
      documentTemplateId: createdId,
      fieldKey: field.fieldKey,
      name: field.name,
      fieldType: field.fieldType,
      pageNumber: field.pageNumber,
      posX: field.posX,
      posY: field.posY,
      width: field.width,
      height: field.height,
      isRequired: field.isRequired,
      sortOrder: field.sortOrder,
    })),
  })
  const newFields = await tx.documentTemplateField.findMany({ where: { documentTemplateId: createdId } })
  const newFieldIdByKey = new Map(newFields.map((field) => [field.fieldKey, field.id]))
  const oldFieldKeyById = new Map(priorFields.map((field) => [field.id, field.fieldKey]))
  const rootGroups = await tx.templateConditionGroup.findMany({
    where: { documentTemplateFieldId: { in: priorFields.map((field) => field.id) }, parentGroupId: null },
    include: { conditions: true, childGroups: { include: { conditions: true } } },
  })
  for (const root of rootGroups) {
    const fieldKey = oldFieldKeyById.get(root.documentTemplateFieldId as string)
    const newFieldId = fieldKey ? newFieldIdByKey.get(fieldKey) : undefined
    if (!newFieldId) throw new UploadLifecycleError("CONFLICT", "Template fields changed during version creation.")
    const newRoot = await tx.templateConditionGroup.create({
      data: { organizationId, purpose: root.purpose, logicOperator: root.logicOperator, documentTemplateFieldId: newFieldId },
    })
    if (root.conditions.length > 0) {
      await tx.templateCondition.createMany({
        data: root.conditions.map((condition) => ({
          groupId: newRoot.id,
          sourceType: condition.sourceType,
          sourceFieldKey: condition.sourceFieldKey,
          operator: condition.operator,
          comparisonValue: (condition.comparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
          sortOrder: condition.sortOrder,
        })),
      })
    }
    for (const child of root.childGroups) {
      const newChild = await tx.templateConditionGroup.create({
        data: { organizationId, purpose: child.purpose, logicOperator: child.logicOperator, parentGroupId: newRoot.id },
      })
      if (child.conditions.length > 0) {
        await tx.templateCondition.createMany({
          data: child.conditions.map((condition) => ({
            groupId: newChild.id,
            sourceType: condition.sourceType,
            sourceFieldKey: condition.sourceFieldKey,
            operator: condition.operator,
            comparisonValue: (condition.comparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
            sortOrder: condition.sortOrder,
          })),
        })
      }
    }
  }
}

async function finishQuarantineCleanup(attempt: UploadAttempt, adapter: StorageAdapter): Promise<void> {
  if (!attempt.quarantineObjectKey || !attempt.quarantineObjectVersionId) return
  await adapter.deleteObject({
    key: attempt.quarantineObjectKey,
    location: "quarantine",
    versionId: attempt.quarantineObjectVersionId,
  })
  await recordCompleted(attempt.id, UploadStatus.LINKED_CLEANUP_PENDING, new Date())
}

export async function completeTemplateUpload(
  attemptId: string,
  staffUserId: string,
  adapter: StorageAdapter = createStorageAdapter(),
): Promise<TemplateUploadResult> {
  assertTemplateUploadRuntimeAvailable()
  let attempt = await prisma.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.actorType !== UploadActorType.STAFF || attempt.staffUserId !== staffUserId) {
    throw new UploadLifecycleError("CONFLICT", "Upload not found.")
  }
  if (attempt.uploadKind !== UploadKind.TEMPLATE && attempt.uploadKind !== UploadKind.TEMPLATE_VERSION) {
    throw new UploadLifecycleError("CONFLICT", "Upload not found.")
  }
  if (attempt.status === UploadStatus.COMPLETED) {
    const owner = await prisma.documentTemplate.findUnique({ where: { id: attempt.intendedOwnerId }, select: { version: true } })
    return { attemptId, status: attempt.status, templateId: attempt.intendedOwnerId, version: owner?.version }
  }
  if (attempt.status === UploadStatus.LINKED_CLEANUP_PENDING) {
    await finishQuarantineCleanup(attempt, adapter)
    const owner = await prisma.documentTemplate.findUnique({ where: { id: attempt.intendedOwnerId }, select: { version: true } })
    return { attemptId, status: UploadStatus.COMPLETED, templateId: attempt.intendedOwnerId, version: owner?.version }
  }
  if (attempt.status !== UploadStatus.SCANNING || attempt.malwareStatus !== "CLEAN") {
    throw new UploadLifecycleError("SCAN_UNAVAILABLE", "The verified malware scan is not complete.")
  }
  if (!attempt.quarantineObjectKey || !attempt.quarantineObjectVersionId || !attempt.checksumSha256 || attempt.actualSizeBytes === null) {
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "The quarantine identity is incomplete.")
  }

  await beginPromotion(attemptId)
  const configuration = readStorageConfiguration()
  let promoted
  try {
    promoted = await adapter.copyObject({
      source: { key: attempt.quarantineObjectKey, location: "quarantine", versionId: attempt.quarantineObjectVersionId },
      destination: { key: attempt.plannedDurableObjectKey, location: "durable" },
      mimeType: "application/pdf",
      checksumSha256: attempt.checksumSha256,
      encryption: { mode: "sse-kms" },
      preconditions: { ifNoneMatch: true },
      metadata: { uploadAttemptId: attempt.id },
    })
  } catch (error) {
    await markUploadFailed(attemptId, UploadStatus.PROMOTING, UploadFailureStage.PROMOTION, UploadFailureCategory.PROMOTION_FAILURE, new Date()).catch(() => undefined)
    throw error
  }
  if (
    promoted.provider !== "s3" ||
    !promoted.versionId ||
    promoted.checksumSha256 !== attempt.checksumSha256 ||
    promoted.size !== Number(attempt.actualSizeBytes) ||
    promoted.mimeType !== "application/pdf" ||
    promoted.encryptionKeyReference !== configuration.kmsKeyArn
  ) {
    await markUploadFailed(attemptId, UploadStatus.PROMOTING, UploadFailureStage.PROMOTION, UploadFailureCategory.PROMOTION_FAILURE, new Date())
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Durable object verification failed.")
  }
  try {
    attempt = await recordVerifiedPromotion(attemptId, {
      provider: StorageProvider.S3,
      bucket: promoted.bucket,
      objectKey: promoted.key,
      objectVersionId: promoted.versionId,
      etag: promoted.etag,
      checksumSha256: promoted.checksumSha256,
      sizeBytes: promoted.size,
      mimeType: promoted.mimeType,
      encryptionKeyRef: promoted.encryptionKeyReference,
      providerVerified: true,
      encryptionVerified: true,
      promotedAt: new Date(),
    })
  } catch (error) {
    await markUploadFailed(attemptId, UploadStatus.PROMOTING, UploadFailureStage.PROMOTION, UploadFailureCategory.PROMOTION_FAILURE, new Date()).catch(() => undefined)
    throw error
  }

  const compatibilityKey = `templates/${attempt.organizationId}/${attempt.artifactId}.pdf`
  let compatibility
  try {
    const durable = await adapter.getObjectStream({ key: promoted.key, location: "durable", versionId: promoted.versionId })
    compatibility = await storeFileFromStream(compatibilityKey, durable.stream, "application/pdf", "template.pdf")
  } catch (error) {
    await markUploadFailed(attemptId, UploadStatus.PROMOTED, UploadFailureStage.LINKAGE, UploadFailureCategory.STORAGE_FAILURE, new Date()).catch(() => undefined)
    throw error
  }
  await beginLinking(attemptId)

  let owner: { id: string; version: number }
  try {
    owner = await prisma.$transaction(async (tx) => {
      const current = await tx.uploadAttempt.findUnique({
        where: { id: attemptId },
        include: { templateIntent: true, storedObject: true },
      })
      const intent = current?.templateIntent
      const storedObject = current?.storedObject
      if (!current || !intent || !storedObject || current.status !== UploadStatus.LINKING || storedObject.lifecycleStatus !== StoredObjectLifecycleStatus.PENDING) {
        throw new UploadLifecycleError("CONFLICT", "The template upload cannot be linked in its current state.")
      }
      let version = 1
      if (intent.previousVersionId) {
        const previous = await tx.documentTemplate.findUnique({ where: { id: intent.previousVersionId } })
        if (!previous || previous.organizationId !== current.organizationId) {
          throw new UploadLifecycleError("CONFLICT", "The previous template version is unavailable.")
        }
        version = previous.version + 1
      }
      const created = await tx.documentTemplate.create({
        data: {
          id: intent.documentTemplateId,
          organizationId: current.organizationId,
          name: intent.name,
          description: intent.description,
          formType: intent.formType,
          program: intent.program,
          version,
          previousVersionId: intent.previousVersionId,
          fileUrl: compatibility.url,
          fileKey: compatibility.key,
          fileSize: promoted.size,
          mimeType: promoted.mimeType,
          uploadedById: staffUserId,
          status: "draft",
          storedObjectId: storedObject.id,
        },
      })
      if (intent.previousVersionId) {
        await cloneTemplateFieldsAndConditions(tx, intent.previousVersionId, created.id, current.organizationId)
      }
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
        ownerType: UploadOwnerType.DOCUMENT_TEMPLATE,
        ownerId: created.id,
        sizeBytes: promoted.size,
        mimeType: promoted.mimeType,
        action: intent.previousVersionId ? AuditAction.DOCUMENT_TEMPLATE_VERSION_CREATED : AuditAction.TEMPLATE_UPLOADED,
      })
      const attemptUpdate = await tx.uploadAttempt.updateMany({
        where: { id: current.id, status: UploadStatus.LINKING },
        data: {
          status: UploadStatus.LINKED_CLEANUP_PENDING,
          linkedAt: new Date(),
          cleanupStatus: UploadCleanupStatus.PENDING,
        },
      })
      if (attemptUpdate.count !== 1) throw new UploadLifecycleError("CONFLICT", "Upload linkage changed concurrently.")
      return { id: created.id, version: created.version }
    })
  } catch (error) {
    await markUploadFailed(
      attemptId,
      UploadStatus.LINKING,
      UploadFailureStage.LINKAGE,
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
        ? UploadFailureCategory.CONFLICT
        : UploadFailureCategory.DATABASE_FAILURE,
      new Date(),
    ).catch(() => undefined)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new UploadLifecycleError("CONFLICT", "A newer template version already exists.", UploadFailureCategory.CONFLICT)
    }
    throw error
  }

  attempt = await prisma.uploadAttempt.findUniqueOrThrow({ where: { id: attemptId } })
  try {
    await finishQuarantineCleanup(attempt, adapter)
    return { attemptId, status: UploadStatus.COMPLETED, templateId: owner.id, version: owner.version }
  } catch {
    return { attemptId, status: UploadStatus.LINKED_CLEANUP_PENDING, templateId: owner.id, version: owner.version }
  }
}
