"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import {
  CLIENT_READ_ROLES,
  ORGANIZATION_WIDE_CLIENT_ROLES,
  getLiveStaffAuthorizationContext,
  requireActiveOrganizationMembership,
  requireClientAccess,
  requireDocumentAccess,
  requireOrganizationRole,
  requirePacketAccess,
} from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"
import { UserRole } from "@prisma/client"
import { storeFile, signStaffFileUrl } from "@/lib/storage"

const MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function getLibraryDocuments(orgId: string, params?: { tab?: string; search?: string; category?: string; clientId?: string; status?: string }) {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "list document library")

  const tab = params?.tab || "active"
  const now = new Date()
  const assignments = {
    some: {
      staffUserId: authorization.userId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    },
  }
  const assignmentScoped = !ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role)
  const packetWhere: Record<string, unknown> = { organizationId: orgId }
  if (tab === "approved") packetWhere.status = { in: ["approved", "archived"] }
  if (tab === "active") packetWhere.status = { notIn: ["approved", "archived"] }
  if (params?.status) packetWhere.status = params.status
  if (params?.clientId) packetWhere.clientId = params.clientId
  if (assignmentScoped) packetWhere.client = { assignments }

  // Get packet documents with template info
  const packetDocs = await prisma.packetDocument.findMany({
    where: {
      packet: packetWhere,
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
      ...(assignmentScoped ? { client: { assignments } } : {}),
      ...(params?.search ? { title: { contains: params.search, mode: "insensitive" } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 50,
    include: { uploadedBy: { select: { name: true } }, client: { select: { firstName: true, lastName: true } } },
  })

  return { packetDocs, templates, supportingDocs }
}

export async function getLibraryDashboardSummary(orgId: string) {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "view document library dashboard")
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000)
  const now = new Date()
  const assignmentScoped = !ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role)
  const assignments = {
    some: {
      staffUserId: authorization.userId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    },
  }
  const packetScope = { organizationId: orgId, ...(assignmentScoped ? { client: { assignments } } : {}) }

  const [statusRows, awaitingSignature, totalTemplates, totalSupporting, recentActivity, allPacketDocs] = await Promise.all([
    prisma.packetDocument.groupBy({
      by: ["status"],
      where: { packet: packetScope },
      _count: true,
    }),
    prisma.packetDocument.count({
      where: { packet: { ...packetScope, status: "awaiting_signature" } },
    }),
    prisma.documentTemplate.count({ where: { organizationId: orgId } }),
    prisma.supportingDocument.count({ where: { organizationId: orgId, ...(assignmentScoped ? { client: { assignments } } : {}) } }),
    prisma.auditEvent.findMany({
      where: {
        organizationId: orgId,
        action: { in: ["DOCUMENT_UPLOADED", "DOCUMENT_SAVED", "PDF_VERSION_CREATED", "TEMPLATE_UPLOADED", "DOCUMENT_FIELD_UPDATED"] },
        createdAt: { gte: thirtyDaysAgo },
        ...(assignmentScoped ? { actorId: authorization.userId } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 8,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.packetDocument.findMany({
      where: { packet: packetScope },
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
    let clientId = data.clientId
    let authorization
    if (data.packetId) {
      authorization = await requirePacketAccess(data.packetId, "manage", "upload supporting document")
      const packet = await prisma.packet.findUnique({ where: { id: data.packetId }, select: { clientId: true, organizationId: true } })
      if (!packet || packet.organizationId !== authorization.organizationId || (data.clientId && packet.clientId !== data.clientId)) {
        return { success: false, error: "Packet not found" }
      }
      clientId = packet.clientId
    } else if (clientId) {
      authorization = await requireClientAccess(clientId, "manage", "upload supporting document")
    } else {
      const identity = await getLiveStaffAuthorizationContext()
      if (!identity.selectedOrganizationId) return { success: false, error: "Select an organization" }
      authorization = await requireOrganizationRole(identity.selectedOrganizationId, ORGANIZATION_WIDE_CLIENT_ROLES, "upload unbound supporting document")
    }
    if (!MANAGER_ROLES.includes(authorization.role)) return { success: false, error: "Insufficient permissions" }
    const orgId = authorization.organizationId

    const safeName = data.fileName.replace(/[/\\]/g, "_").replace(/^\.+/, "")
    const key = `supporting/${orgId}/${Date.now()}-${safeName}`
    const record = await storeFile(key, data.fileBuffer, data.mimeType, data.fileName)

    const doc = await prisma.supportingDocument.create({
      data: {
        organizationId: orgId, title: data.title, category: data.category || "supporting",
        description: data.description, clientId: clientId || null, packetId: data.packetId || null,
        fileUrl: record.url, fileKey: record.key, fileSize: record.size, mimeType: data.mimeType,
        uploadedById: authorization.userId,
      },
    })

    await createAuditEvent({
      organizationId: orgId, actorId: authorization.userId,
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
  if (documentType === "packet") {
    await requireDocumentAccess(documentId, "read", "view library packet document")
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
    return { ...doc, type: "packet" as const, signedUrl: doc.documentTemplate.fileKey ? signStaffFileUrl("packet_document", doc.id) : null }
  }

  if (documentType === "template") {
    const target = await prisma.documentTemplate.findUnique({ where: { id: documentId }, select: { organizationId: true } })
    if (!target) return null
    await requireActiveOrganizationMembership(target.organizationId, "view library document template")
    const doc = await prisma.documentTemplate.findUnique({
      where: { id: documentId },
      include: { uploadedBy: { select: { name: true, email: true } } },
    })
    if (!doc) return null
    return { ...doc, type: "template" as const, signedUrl: doc.fileKey ? signStaffFileUrl("document_template", doc.id) : null }
  }

  if (documentType === "supporting") {
    const target = await prisma.supportingDocument.findUnique({
      where: { id: documentId },
      select: { organizationId: true, clientId: true, packetId: true },
    })
    if (!target) return null
    const authorization = target.packetId
      ? await requirePacketAccess(target.packetId, "read", "view library supporting document")
      : target.clientId
        ? await requireClientAccess(target.clientId, "read", "view library supporting document")
        : await requireActiveOrganizationMembership(target.organizationId, "view library supporting document")
    if (authorization.organizationId !== target.organizationId) return null
    const doc = await prisma.supportingDocument.findUnique({
      where: { id: documentId },
      include: { uploadedBy: { select: { name: true } }, client: { select: { firstName: true, lastName: true } } },
    })
    if (!doc) return null
    return { ...doc, type: "supporting" as const, signedUrl: doc.fileKey ? signStaffFileUrl("supporting_document", doc.id) : null }
  }

  return null
}
