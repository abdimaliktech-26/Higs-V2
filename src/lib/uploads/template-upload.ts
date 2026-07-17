import "server-only"

import { randomUUID } from "node:crypto"
import {
  AuditAction,
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
import { assertUploadRuntimeAvailable, receiveValidateAndBeginScan } from "./receipt"
import { MAX_UPLOAD_BYTES } from "./types"
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
  try {
    assertUploadRuntimeAvailable()
  } catch {
    throw new TemplateUploadUnavailableError()
  }
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

  await receiveValidateAndBeginScan({ attempt, file: input.file, adapter, quarantineMimeType: "application/pdf" })
  return { attemptId: attempt.id, status: UploadStatus.SCANNING }
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
  const promotion = await promoteVerifiedCleanUpload(attempt, "application/pdf", adapter)
  attempt = promotion.attempt
  const promoted = promotion.promoted

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
