"use server"

import { revalidatePath } from "next/cache"
import { validate, saveFieldsSchema, addFieldSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { signUrl } from "@/lib/storage"
import { reconcilePacketDocumentApplicability, buildPacketConditionContext, buildEditorDocumentConditionState } from "@/lib/conditions/runtime"

const EDIT_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]
const READ_ROLES: UserRole[] = ["DSP", "NURSE"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

// ── Step 4c.3a: server-authoritative visibility/requiredness in the editor
// DTO. Condition evaluation is read-only here — no writes, no reconciliation,
// no audit beyond the existing DOCUMENT_VIEWED event. A condition-aware
// packet's field visibility/effective-requiredness is computed once per
// request from buildPacketConditionContext + the packet's immutable
// snapshot; live mutable template conditions are never read for this. A
// legacy packet (no snapshot) always reports every field visible with its
// persisted static requiredness, unchanged from before this step. A
// CONDITIONALLY_INACTIVE document or one with a condition integrity error
// still loads (for historical/inspection access) but is forced read-only —
// neither state blocks the page, and neither ever mutates anything on read.
export async function getEditableDocument(documentId: string) {
  const session = await auth()
  if (!session?.user) throw new Error("Unauthorized")
  const user = session.user as Record<string, unknown>

  const doc = await prisma.packetDocument.findUnique({
    where: { id: documentId },
    include: {
      documentTemplate: true,
      packet: {
        include: {
          client: { select: { id: true, firstName: true, lastName: true, mcadId: true } },
          program: { select: { name: true } },
          assignedTo: { select: { name: true, email: true } },
        },
      },
      fields: { orderBy: { sortOrder: "asc" } },
      versions: { orderBy: { version: "desc" }, take: 20 },
      comments: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { createdBy: { select: { name: true, email: true } } },
      },
    },
  })

  if (!doc) throw new Error("Document not found")
  await requireOrgAccess(doc.packet.organizationId)

  const role = getActiveRole(user as any)
  const isSuperAdmin = user.isSuperAdmin as boolean
  const hasAccess = isSuperAdmin || EDIT_ROLES.includes(role) || READ_ROLES.includes(role)

  if (!hasAccess) throw new Error("Access denied: insufficient permissions")

  // One buildPacketConditionContext call per request — never per field. Also
  // independently re-verifies organization/parent-chain consistency
  // (packet/client, packet/template, packet/program, and for condition-aware
  // packets, snapshot/organization and snapshot/template identity) before
  // any evaluation runs.
  const runtime = await buildPacketConditionContext(doc.packetId)
  const conditionState = buildEditorDocumentConditionState(
    runtime,
    { id: doc.id, applicabilityStatus: doc.applicabilityStatus, packetTemplateDocumentId: doc.packetTemplateDocumentId },
    doc.fields.map((f) => ({ id: f.id, templateFieldKey: f.templateFieldKey, isRequired: f.isRequired }))
  )

  const isApproved = doc.packet.status === "approved" || doc.packet.status === "archived"
  const isDocumentInactive = doc.applicabilityStatus === "CONDITIONALLY_INACTIVE"
  const roleIsReadOnly = !isSuperAdmin && !EDIT_ROLES.includes(role)
  const isReadOnly = isApproved || roleIsReadOnly || isDocumentInactive || conditionState.hasConditionIntegrityError

  // Priority mirrors severity/actionability: a configuration error and
  // inactivity both need a distinct explanation (they're not the everyday
  // "you don't have edit rights" case); approval-lock and role-based
  // view-only reuse their existing, already-understood meanings.
  const readOnlyReason: string | null = conditionState.hasConditionIntegrityError
    ? "This document has a compliance configuration error and cannot be edited until it is resolved."
    : isDocumentInactive
      ? "This document is currently not applicable based on packet conditions."
      : isApproved
        ? "This document is approved and locked for editing."
        : roleIsReadOnly
          ? "Your role has view-only access to this document."
          : null

  await createAuditEvent({
    organizationId: doc.packet.organizationId,
    actorId: user.id as string,
    action: "DOCUMENT_VIEWED",
    targetType: "packet_document",
    targetId: documentId,
    metadata: { packetId: doc.packetId, documentName: doc.documentTemplate.name, readOnly: isReadOnly },
  })

  const fields = doc.fields.map((field) => {
    const view = conditionState.fieldsById[field.id]
    return {
      id: field.id,
      name: field.name,
      fieldType: field.fieldType,
      pageNumber: field.pageNumber,
      posX: field.posX,
      posY: field.posY,
      width: field.width,
      height: field.height,
      value: field.value,
      source: field.source,
      sortOrder: field.sortOrder,
      confidence: field.confidence,
      // Preserved verbatim, unchanged — the current editor client still
      // reads this directly; removing it before Step 4c.3c ships the UI
      // that reads staticRequired/effectiveRequired instead would break it.
      isRequired: field.isRequired,
      staticRequired: field.isRequired,
      effectiveRequired: view.effectiveRequired,
      isVisible: view.isVisible,
      templateFieldKey: field.templateFieldKey,
      conditionallyRequired: view.conditionallyRequired,
      visibilityConditionPresent: view.visibilityConditionPresent,
      requirednessConditionPresent: view.requirednessConditionPresent,
    }
  })

  return {
    ...doc,
    fields,
    isReadOnly,
    readOnlyReason,
    isLockedByApproval: isApproved,
    applicabilityStatus: doc.applicabilityStatus,
    conditionMode: conditionState.conditionMode,
    isConditionAware: conditionState.isConditionAware,
    hasConditionIntegrityError: conditionState.hasConditionIntegrityError,
    conditionIntegrityErrorCount: conditionState.conditionIntegrityErrorCount,
    conditionConfigurationError: conditionState.hasConditionIntegrityError,
    reconciliationPending: conditionState.reconciliationPending,
    pdfUrl: doc.documentTemplate.fileKey ? signUrl(doc.documentTemplate.fileKey) : null,
    versions: doc.versions.map((v) => ({
      ...v,
      signedUrl: v.fileKey ? signUrl(v.fileKey) : null,
    })),
  }
}

// ── Step 4c.2b: transactional save, field-ownership verified, condition
// reconciliation wired for condition-aware packets. Field writes, the
// edited document's status recalculation, applicability reconciliation, and
// every audit event all commit together or not at all — a failure anywhere
// (including a reconciliation integrity error) rolls back the whole save,
// leaving prior field values and document states untouched. Legacy packets
// (no condition snapshot) behave exactly as before: fields save, status
// recalculates from static isRequired, no reconciliation, no new audit.
export async function saveDocumentFields(
  documentId: string,
  fields: { id?: string; name: string; fieldType: string; value?: string; pageNumber: number; posX?: number; posY?: number; isRequired: boolean }[]
): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: true },
    })
    if (!doc) return { success: false, error: "Document not found" }
    await requireOrgAccess(doc.packet.organizationId)
    const role = getActiveRole(user as any)
    if (!(user.isSuperAdmin as boolean) && !EDIT_ROLES.includes(role))
      return { success: false, error: "Insufficient permissions" }

    const isConditionAware = Boolean(doc.packet.conditionSnapshotId && doc.packet.conditionRuntimeVersion)

    const result = await prisma.$transaction(async (tx) => {
      // Field ownership — every submitted existing-field id must belong to
      // THIS document. Rejects cross-document, cross-packet, and
      // cross-tenant field ids in one pass (the document itself was already
      // verified to belong to the caller's organization above).
      const existingFields = await tx.pdfField.findMany({ where: { packetDocumentId: documentId }, select: { id: true } })
      const existingFieldIds = new Set(existingFields.map((f) => f.id))
      for (const f of fields) {
        if (f.id && !existingFieldIds.has(f.id)) throw new Error("One or more fields do not belong to this document")
      }

      for (const f of fields) {
        if (f.id) {
          await tx.pdfField.update({ where: { id: f.id }, data: { value: f.value, posX: f.posX, posY: f.posY } })
        } else {
          await tx.pdfField.create({
            data: {
              packetDocumentId: documentId, name: f.name, fieldType: f.fieldType,
              value: f.value, pageNumber: f.pageNumber, posX: f.posX, posY: f.posY,
              isRequired: f.isRequired, source: "manual", confidence: 1.0,
            },
          })
        }
      }

      // Static requiredness only — effective, condition-aware requiredness
      // is not integrated here (deferred to a later step); this recompute
      // is unchanged from before Step 4c.2b.
      const pendingRequired = await tx.pdfField.count({
        where: { packetDocumentId: documentId, isRequired: true, value: null },
      })
      const newStatus = pendingRequired === 0 ? "completed" : "in_progress"
      await tx.packetDocument.update({ where: { id: documentId }, data: { status: newStatus } })

      await createAuditEvent({
        organizationId: doc.packet.organizationId,
        actorId: user.id as string,
        action: "DOCUMENT_SAVED",
        targetType: "packet_document",
        targetId: documentId,
        metadata: { fieldCount: fields.length, status: newStatus },
      }, tx)

      if (isConditionAware) {
        await reconcilePacketDocumentApplicability(tx, doc.packet.id, user.id as string)
      }

      return { status: newStatus }
    })

    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function addPdfField(data: {
  packetDocumentId: string; name: string; fieldType: string; pageNumber: number
}): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const doc = await prisma.packetDocument.findUnique({ where: { id: data.packetDocumentId }, include: { packet: true } })
    if (!doc) return { success: false, error: "Not found" }
    await requireOrgAccess(doc.packet.organizationId)

    const field = await prisma.pdfField.create({
      data: { packetDocumentId: data.packetDocumentId, name: data.name, fieldType: data.fieldType, pageNumber: data.pageNumber, source: "manual" },
    })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: user.id as string,
      action: "DOCUMENT_FIELD_ADDED",
      targetType: "pdf_field",
      targetId: field.id,
      metadata: { fieldName: data.name, documentId: data.packetDocumentId },
    })
    revalidatePath(`/documents/${data.packetDocumentId}/edit`)
    return { success: true, data: { id: field.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updatePdfField(fieldId: string, data: { value?: string; posX?: number; posY?: number }): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const field = await prisma.pdfField.findUnique({ where: { id: fieldId }, include: { packetDocument: { include: { packet: true } } } })
    if (!field) return { success: false, error: "Not found" }
    await requireOrgAccess(field.packetDocument.packet.organizationId)

    await prisma.pdfField.update({ where: { id: fieldId }, data })

    await createAuditEvent({
      organizationId: field.packetDocument.packet.organizationId,
      actorId: user.id as string,
      action: "DOCUMENT_FIELD_UPDATED",
      targetType: "pdf_field",
      targetId: fieldId,
      metadata: { fieldName: field.name, documentId: field.packetDocumentId },
    })
    return { success: true, data: { id: fieldId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function createPdfVersion(documentId: string, comment?: string): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: true, documentTemplate: true },
    })
    if (!doc) return { success: false, error: "Not found" }
    await requireOrgAccess(doc.packet.organizationId)

    const nextVersion = doc.currentVersion + 1
    const now = new Date().toISOString().split("T")[0]

    await prisma.pdfVersion.create({
      data: {
        packetDocumentId: documentId, version: nextVersion,
        fileUrl: `https://storage.higsi.com/documents/${documentId}/v${nextVersion}.pdf`,
        fileKey: `documents/${documentId}/v${nextVersion}.pdf`,
        comment: comment || `Version ${nextVersion}`,
        createdById: user.id as string,
      },
    })

    await prisma.packetDocument.update({ where: { id: documentId }, data: { currentVersion: nextVersion } })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: user.id as string,
      action: "PDF_VERSION_CREATED",
      targetType: "packet_document",
      targetId: documentId,
      metadata: { version: nextVersion, documentName: doc.documentTemplate.name },
    })
    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: { version: nextVersion } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function addDocumentComment(documentId: string, text: string): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: true },
    })
    if (!doc) return { success: false, error: "Not found" }
    await requireOrgAccess(doc.packet.organizationId)

    const comment = await prisma.documentComment.create({
      data: { packetDocumentId: documentId, text, createdById: user.id as string },
    })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: user.id as string,
      action: "DOCUMENT_COMMENT_ADDED",
      targetType: "document_comment",
      targetId: comment.id,
      metadata: { documentId },
    })
    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: { id: comment.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Narrow, single-document portal-sharing toggle — no bulk sharing, no
 * auto-sharing of an entire packet. Disabling immediately removes portal
 * access to this specific document (portalVisible defaults false and is
 * only ever flipped true by this explicit, per-document staff action).
 */
export async function setPacketDocumentPortalVisibility(
  documentId: string,
  input: { portalVisible: boolean; portalAccessLevel?: "VIEW" | "VIEW_AND_DOWNLOAD" }
): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: { select: { organizationId: true } } },
    })
    if (!doc) return { success: false, error: "Not found" }

    await requireOrgAccess(doc.packet.organizationId)
    const role = getActiveRole(user as any)
    if (!EDIT_ROLES.includes(role) && !(user.isSuperAdmin as boolean)) {
      return { success: false, error: "Insufficient permissions" }
    }

    const updated = await prisma.packetDocument.update({
      where: { id: documentId },
      data: input.portalVisible
        ? {
            portalVisible: true,
            portalVisibleAt: new Date(),
            sharedByUserId: user.id as string,
            portalAccessLevel: input.portalAccessLevel || "VIEW",
          }
        : {
            portalVisible: false,
            portalVisibleAt: null,
            sharedByUserId: null,
            portalAccessLevel: null,
          },
    })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: user.id as string,
      action: "DOCUMENT_PORTAL_VISIBILITY_CHANGED",
      targetType: "packet_document",
      targetId: documentId,
      metadata: { portalVisible: input.portalVisible, portalAccessLevel: updated.portalAccessLevel },
    })

    revalidatePath(`/packets/${doc.packetId}`)
    return { success: true, data: { id: documentId, portalVisible: updated.portalVisible } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
