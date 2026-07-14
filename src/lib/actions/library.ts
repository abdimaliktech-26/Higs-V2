"use server"

import { revalidatePath } from "next/cache"
import { validate } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole, type Prisma } from "@prisma/client"
import { storeFile, signStaffFileUrl } from "@/lib/storage"

const MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function getLibraryDocuments(orgId: string, params?: { tab?: string; search?: string; category?: string; clientId?: string; status?: string }) {
  await requireOrgAccess(orgId)

  const tab = params?.tab || "active"

  // Get packet documents with template info
  const packetDocs = await prisma.packetDocument.findMany({
    where: {
      packet: { organizationId: orgId },
      ...(tab === "approved" ? { packet: { status: { in: ["approved", "archived"] } } } : {}),
      ...(tab === "active" ? { packet: { status: { notIn: ["approved", "archived"] } } } : {}),
      ...(params?.status ? { packet: { status: params.status } } : {}),
      ...(params?.clientId ? { packet: { clientId: params.clientId } } : {}),
      ...(params?.search ? { documentTemplate: { name: { contains: params.search, mode: "insensitive" } } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
    include: {
      documentTemplate: { select: { id: true, name: true, formType: true, fileKey: true, version: true } },
      packet: { select: { id: true, packetType: true, status: true, client: { select: { firstName: true, lastName: true, mcadId: true } } } },
    },
  })

  // Get template documents
  const templates = tab === "active" || tab === "templates" ? await prisma.documentTemplate.findMany({
    where: { organizationId: orgId, ...(params?.search ? { name: { contains: params.search, mode: "insensitive" } } : {}) },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { uploadedBy: { select: { name: true } } },
  }) : []

  // Get supporting documents
  const supportingDocs = await prisma.supportingDocument.findMany({
    where: {
      organizationId: orgId,
      ...(tab === "supporting" || tab === "active" || tab === "all" ? {} : { id: "-" }),
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.clientId ? { clientId: params.clientId } : {}),
      ...(params?.search ? { title: { contains: params.search, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { uploadedBy: { select: { name: true } }, client: { select: { firstName: true, lastName: true } } },
  })

  return { packetDocs, templates, supportingDocs }
}

export async function getLibraryDashboardSummary(orgId: string) {
  await requireOrgAccess(orgId)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)

  const [statusRows, awaitingSignature, totalTemplates, totalSupporting, recentActivity, allPacketDocs] = await Promise.all([
    prisma.packetDocument.groupBy({
      by: ["status"],
      where: { packet: { organizationId: orgId } },
      _count: true,
    }),
    prisma.packetDocument.count({
      where: { packet: { organizationId: orgId, status: "awaiting_signature" } },
    }),
    prisma.documentTemplate.count({ where: { organizationId: orgId } }),
    prisma.supportingDocument.count({ where: { organizationId: orgId } }),
    prisma.auditEvent.findMany({
      where: {
        organizationId: orgId,
        action: { in: ["DOCUMENT_UPLOADED", "DOCUMENT_SAVED", "PDF_VERSION_CREATED", "TEMPLATE_UPLOADED", "DOCUMENT_FIELD_UPDATED"] },
        createdAt: { gte: thirtyDaysAgo },
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.packetDocument.findMany({
      where: { packet: { organizationId: orgId } },
      select: { packet: { select: { status: true } } },
    }),
  ])

  const totalActive = allPacketDocs.filter((d) => !["approved", "archived"].includes(d.packet.status)).length
  const totalLocked = allPacketDocs.filter((d) => ["approved", "archived"].includes(d.packet.status)).length

  return {
    statusBreakdown: statusRows.map((r) => ({ status: r.status, count: r._count })),
    awaitingSignature,
    totalActive,
    totalLocked,
    totalDocuments: allPacketDocs.length,
    totalTemplates,
    totalSupporting,
    recentActivity,
  }
}

export async function uploadSupportingDocument(data: {
  title: string; category?: string; description?: string; clientId?: string; packetId?: string
  fileBuffer: Buffer; fileName: string; mimeType: string
}): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const orgId = user.activeOrganizationId as string
    await requireOrgAccess(orgId)
    if (!MANAGER_ROLES.includes(getActiveRole(user as any)) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const safeName = data.fileName.replace(/[/\\]/g, "_").replace(/^\.+/, "")
    const key = `supporting/${orgId}/${Date.now()}-${safeName}`
    const record = await storeFile(key, data.fileBuffer, data.mimeType, data.fileName)

    const doc = await prisma.supportingDocument.create({
      data: {
        organizationId: orgId, title: data.title, category: data.category || "supporting",
        description: data.description, clientId: data.clientId || null, packetId: data.packetId || null,
        fileUrl: record.url, fileKey: record.key, fileSize: record.size, mimeType: data.mimeType,
        uploadedById: user.id as string,
      },
    })

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string,
      action: "DOCUMENT_UPLOADED", targetType: "supporting_document", targetId: doc.id,
      metadata: { title: data.title },
    })

    revalidatePath("/library")
    return { success: true, data: { id: doc.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getDocumentDetail(documentType: string, documentId: string) {
  const session = await auth()
  if (!session?.user) throw new Error("Unauthorized")

  if (documentType === "packet") {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: {
        documentTemplate: true,
        packet: { include: { client: { select: { firstName: true, lastName: true, mcadId: true } } } },
        fields: { take: 10, orderBy: { sortOrder: "asc" } },
        versions: { orderBy: { version: "desc" }, take: 5 },
      },
    })
    if (!doc) return null
    await requireOrgAccess(doc.packet.organizationId)
    return { ...doc, type: "packet" as const, signedUrl: doc.documentTemplate.fileKey ? signStaffFileUrl("packet_document", doc.id) : null }
  }

  if (documentType === "template") {
    const doc = await prisma.documentTemplate.findUnique({
      where: { id: documentId },
      include: { uploadedBy: { select: { name: true, email: true } } },
    })
    if (!doc) return null
    await requireOrgAccess(doc.organizationId)
    return { ...doc, type: "template" as const, signedUrl: doc.fileKey ? signStaffFileUrl("document_template", doc.id) : null }
  }

  if (documentType === "supporting") {
    const doc = await prisma.supportingDocument.findUnique({
      where: { id: documentId },
      include: { uploadedBy: { select: { name: true } }, client: { select: { firstName: true, lastName: true } } },
    })
    if (!doc) return null
    await requireOrgAccess(doc.organizationId)
    return { ...doc, type: "supporting" as const, signedUrl: doc.fileKey ? signStaffFileUrl("supporting_document", doc.id) : null }
  }

  return null
}
