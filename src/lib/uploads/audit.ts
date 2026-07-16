import { AuditAction, PortalAuditAction, Prisma, UploadOwnerType } from "@prisma/client"

export interface StrictStaffUploadAuditInput {
  organizationId: string
  staffUserId: string
  uploadAttemptId: string
  storedObjectId: string
  ownerType: UploadOwnerType
  ownerId: string
  sizeBytes: number
  mimeType: string
  action?: typeof AuditAction.TEMPLATE_UPLOADED | typeof AuditAction.DOCUMENT_TEMPLATE_VERSION_CREATED
}

export interface StrictPortalUploadAuditInput {
  organizationId: string
  portalUserId: string
  clientId: string
  uploadAttemptId: string
  storedObjectId: string
  ownerType: UploadOwnerType
  ownerId: string
  sizeBytes: number
  mimeType: string
}

/**
 * Mandatory linkage evidence for a future staff upload owner transaction.
 * Unlike the repository-wide best-effort helper, this accepts only a
 * transaction client and deliberately propagates database failures.
 */
export async function writeStrictStaffUploadAudit(
  tx: Pick<Prisma.TransactionClient, "auditEvent">,
  input: StrictStaffUploadAuditInput,
): Promise<void> {
  await tx.auditEvent.create({
    data: {
      organizationId: input.organizationId,
      actorId: input.staffUserId,
      action: input.action ?? AuditAction.DOCUMENT_UPLOADED,
      targetType: input.ownerType,
      targetId: input.ownerId,
      metadata: {
        uploadAttemptId: input.uploadAttemptId,
        storedObjectId: input.storedObjectId,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      },
    },
  })
}

/** Same strict rollback boundary for a future portal upload linkage. */
export async function writeStrictPortalUploadAudit(
  tx: Pick<Prisma.TransactionClient, "portalAuditEvent">,
  input: StrictPortalUploadAuditInput,
): Promise<void> {
  await tx.portalAuditEvent.create({
    data: {
      organizationId: input.organizationId,
      portalUserId: input.portalUserId,
      clientId: input.clientId,
      action: PortalAuditAction.PORTAL_DOCUMENT_UPLOADED,
      targetType: input.ownerType,
      targetId: input.ownerId,
      metadata: {
        uploadAttemptId: input.uploadAttemptId,
        storedObjectId: input.storedObjectId,
        sizeBytes: input.sizeBytes,
        mimeType: input.mimeType,
      },
    },
  })
}
