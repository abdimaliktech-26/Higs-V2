"use server"

import { revalidatePath } from "next/cache"
import { validate, saveFieldsSchema, addFieldSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { signUrl } from "@/lib/storage"

const EDIT_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]
const READ_ROLES: UserRole[] = ["DSP", "NURSE"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

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

  const isApproved = doc.packet.status === "approved" || doc.packet.status === "archived"
  const isReadOnly = isApproved || (!isSuperAdmin && !EDIT_ROLES.includes(role))

  await createAuditEvent({
    organizationId: doc.packet.organizationId,
    actorId: user.id as string,
    action: "DOCUMENT_VIEWED",
    targetType: "packet_document",
    targetId: documentId,
    metadata: { packetId: doc.packetId, documentName: doc.documentTemplate.name, readOnly: isReadOnly },
  })

  return {
    ...doc,
    isReadOnly,
    isLockedByApproval: isApproved,
    pdfUrl: doc.documentTemplate.fileKey ? signUrl(doc.documentTemplate.fileKey) : null,
    versions: doc.versions.map((v) => ({
      ...v,
      signedUrl: v.fileKey ? signUrl(v.fileKey) : null,
    })),
  }
}

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

    // Upsert fields
    for (const f of fields) {
      if (f.id) {
        await prisma.pdfField.update({ where: { id: f.id }, data: { value: f.value, posX: f.posX, posY: f.posY } })
      } else {
        await prisma.pdfField.create({
          data: {
            packetDocumentId: documentId, name: f.name, fieldType: f.fieldType,
            value: f.value, pageNumber: f.pageNumber, posX: f.posX, posY: f.posY,
            isRequired: f.isRequired, source: "manual", confidence: 1.0,
          },
        })
      }
    }

    // Update document status
    const pendingRequired = await prisma.pdfField.count({
      where: { packetDocumentId: documentId, isRequired: true, value: null },
    })
    const newStatus = pendingRequired === 0 ? "completed" : "in_progress"
    await prisma.packetDocument.update({ where: { id: documentId }, data: { status: newStatus } })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: user.id as string,
      action: "DOCUMENT_SAVED",
      targetType: "packet_document",
      targetId: documentId,
      metadata: { fieldCount: fields.length, status: newStatus },
    })

    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: { status: newStatus } }
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
