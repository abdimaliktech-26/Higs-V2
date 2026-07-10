"use server"

import { revalidatePath } from "next/cache"
import { validate, createDocTemplateSchema, createPacketTemplateSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { AuditAction, UserRole, type Prisma } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

function canManage(user: Record<string, unknown>) {
  const role = getActiveRole(user as any)
  return user.isSuperAdmin as boolean || ADMIN_ROLES.includes(role)
}

// === Document Templates ===

export async function getDocumentTemplates(orgId: string, params?: { search?: string; status?: string; formType?: string; program?: string }) {
  await requireOrgAccess(orgId)
  const where: Prisma.DocumentTemplateWhereInput = { organizationId: orgId }
  if (params?.search) where.name = { contains: params.search, mode: "insensitive" }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.formType && params.formType !== "all") where.formType = params.formType
  if (params?.program && params.program !== "all") where.program = params.program
  return prisma.documentTemplate.findMany({
    where,
    include: {
      uploadedBy: { select: { name: true, email: true } },
      _count: { select: { packetTemplateDocs: true, packetDocuments: true } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  })
}

export async function getDocumentTemplateById(id: string) {
  const tpl = await prisma.documentTemplate.findUnique({
    where: { id },
    include: { uploadedBy: { select: { name: true, email: true } } },
  })
  if (!tpl) return null
  await requireOrgAccess(tpl.organizationId)
  return tpl
}

export async function createDocumentTemplate(raw: Record<string, unknown>) {
  const parsed = validate(createDocTemplateSchema, raw)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const data = parsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }
  await requireOrgAccess(orgId)

  const tpl = await prisma.documentTemplate.create({
    data: { organizationId: orgId, name: data.name, description: data.description, formType: data.formType, program: data.program, fileUrl: data.fileUrl, fileKey: data.fileKey, fileSize: data.fileSize, mimeType: "application/pdf", uploadedById: user.id as string, status: "draft" },
  })

  await createAuditEvent({ organizationId: orgId, actorId: user.id as string, action: "TEMPLATE_UPLOADED", targetType: "document_template", targetId: tpl.id, metadata: { name: tpl.name } })
  revalidatePath("/templates")
  return { success: true as const, data: { id: tpl.id } }
}

export async function updateTemplateStatus(id: string, status: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }

  const tpl = await prisma.documentTemplate.findUnique({ where: { id } })
  if (!tpl) return { success: false as const, error: "Not found" }
  await requireOrgAccess(tpl.organizationId)

  await prisma.documentTemplate.update({ where: { id }, data: { status } })
  const action = status === "active" ? "TEMPLATE_ACTIVATED" : status === "retired" ? "TEMPLATE_RETIRED" : null
  if (action) await createAuditEvent({ organizationId: tpl.organizationId, actorId: user.id as string, action: action as any, targetType: "document_template", targetId: id, metadata: { name: tpl.name } })
  revalidatePath("/templates")
  return { success: true as const, data: { id } }
}

// === Packet Templates ===

export async function getPacketTemplates(orgId: string, params?: { includeInactive?: boolean; status?: string; programId?: string; packetType?: string }) {
  await requireOrgAccess(orgId)
  const where: Prisma.PacketTemplateWhereInput = { organizationId: orgId }
  if (params?.includeInactive) {
    if (params.status && params.status !== "all") where.status = params.status
  } else {
    where.status = params?.status && params.status !== "all" ? params.status : "active"
  }
  if (params?.programId && params.programId !== "all") where.programId = params.programId
  if (params?.packetType && params.packetType !== "all") where.packetType = params.packetType

  return prisma.packetTemplate.findMany({
    where,
    include: { program: { select: { id: true, name: true, code: true } }, requiredDocs: { include: { documentTemplate: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  })
}

const TEMPLATE_AUDIT_ACTIONS: AuditAction[] = [
  "TEMPLATE_UPLOADED",
  "TEMPLATE_ACTIVATED",
  "TEMPLATE_RETIRED",
  "PACKET_TEMPLATE_CREATED",
]

export async function getTemplateActivity(orgId: string, limit = 8) {
  await requireOrgAccess(orgId)
  return prisma.auditEvent.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { action: { in: TEMPLATE_AUDIT_ACTIONS } },
        { targetType: { in: ["document_template", "packet_template"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true, email: true } } },
  })
}

export async function createPacketTemplate(raw: Record<string, unknown>) {
  const parsed = validate(createPacketTemplateSchema, raw)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const data = parsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }
  await requireOrgAccess(orgId)

  const pt = await prisma.packetTemplate.create({
    data: { organizationId: orgId, name: data.name, description: data.description, packetType: data.packetType, programId: data.programId || null, isDefault: false, status: "active" },
  })

  for (let i = 0; i < data.documentIds.length; i++) {
    await prisma.packetTemplateDocument.create({
      data: { packetTemplateId: pt.id, documentTemplateId: data.documentIds[i], required: true, sortOrder: i },
    })
  }

  await createAuditEvent({ organizationId: orgId, actorId: user.id as string, action: "PACKET_TEMPLATE_CREATED", targetType: "packet_template", targetId: pt.id, metadata: { name: pt.name } })
  revalidatePath("/templates")
  return { success: true as const, data: { id: pt.id } }
}

// === Packet Instances ===

export async function getPackets(orgId: string, params?: { search?: string; status?: string; page?: number; pageSize?: number }) {
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.search) where.OR = [
    { client: { firstName: { contains: params.search, mode: "insensitive" } } },
    { client: { lastName: { contains: params.search, mode: "insensitive" } } },
    { packetType: { contains: params.search, mode: "insensitive" } },
  ]

  const [packets, total] = await Promise.all([
    prisma.packet.findMany({
      where: where as any,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: { client: { select: { id: true, firstName: true, lastName: true } }, assignedTo: { select: { name: true } }, _count: { select: { documents: true } } },
    }),
    prisma.packet.count({ where: where as any }),
  ])
  return { packets, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getPacketById(packetId: string) {
  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    include: {
      client: { include: { enrollments: { include: { program: true } }, assignments: { include: { staff: { select: { name: true } } } }, organization: { select: { name: true } }, diagnoses: { where: { isActive: true }, select: { code: true, description: true, type: true } } } },
      packetTemplate: { select: { name: true, id: true } },
      program: { select: { name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      documents: {
        include: {
          documentTemplate: true,
          validationResults: { select: { criticalCount: true, warningCount: true }, orderBy: { ranAt: "desc" }, take: 1 },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  })
  if (!packet) return null
  await requireOrgAccess(packet.organizationId)

  await createAuditEvent({ organizationId: packet.organizationId, actorId: undefined, action: "PACKET_VIEWED", targetType: "packet", targetId: packetId, metadata: { clientName: `${packet.client.firstName} ${packet.client.lastName}` } })
  return packet
}

export async function createPacket(data: {
  clientId: string; packetTemplateId: string; dueDate?: string; assignedToId?: string
}) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string
  if (!orgId) return { success: false as const, error: "No org" }
  await requireOrgAccess(orgId)

  const pt = await prisma.packetTemplate.findUnique({
    where: { id: data.packetTemplateId },
    include: { requiredDocs: { include: { documentTemplate: true }, orderBy: { sortOrder: "asc" } } },
  })
  if (!pt) return { success: false as const, error: "Packet template not found" }

  const packet = await prisma.packet.create({
    data: {
      organizationId: orgId, clientId: data.clientId, packetTemplateId: pt.id,
      packetType: pt.packetType, status: "draft", dueDate: data.dueDate ? new Date(data.dueDate) : null,
      assignedToId: data.assignedToId || null,
      metadata: { createdBy: user.id } as Prisma.InputJsonValue,
    },
  })

  // Generate packet documents from template
  for (const doc of pt.requiredDocs) {
    await prisma.packetDocument.create({
      data: { packetId: packet.id, documentTemplateId: doc.documentTemplateId, isRequired: doc.required, sortOrder: doc.sortOrder, status: "pending" },
    })
  }

  await createAuditEvent({ organizationId: orgId, actorId: user.id as string, action: "PACKET_CREATED", targetType: "packet", targetId: packet.id, metadata: { clientId: data.clientId, packetTemplateId: pt.id } })
  revalidatePath("/packets")
  revalidatePath(`/clients/${data.clientId}`)
  return { success: true as const, data: { id: packet.id } }
}

export async function updatePacketStatus(packetId: string, status: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const packet = await prisma.packet.findUnique({ where: { id: packetId } })
  if (!packet) return { success: false as const, error: "Not found" }
  await requireOrgAccess(packet.organizationId)

  const updateData: Record<string, unknown> = { status }
  if (status === "approved" || status === "archived") updateData.completedAt = new Date()

  await prisma.packet.update({ where: { id: packetId }, data: updateData as any })

  await createAuditEvent({ organizationId: packet.organizationId, actorId: user.id as string, action: "PACKET_STATUS_CHANGED", targetType: "packet", targetId: packetId, metadata: { from: packet.status, to: status } })
  revalidatePath(`/packets/${packetId}`)
  revalidatePath("/packets")
  return { success: true as const, data: { id: packetId } }
}

export async function updatePacketDocumentStatus(packetDocumentId: string, status: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const doc = await prisma.packetDocument.findUnique({ where: { id: packetDocumentId }, include: { packet: true } })
  if (!doc) return { success: false as const, error: "Not found" }
  await requireOrgAccess(doc.packet.organizationId)

  await prisma.packetDocument.update({
    where: { id: packetDocumentId },
    data: { status, completedAt: status === "completed" ? new Date() : status === "pending" ? null : undefined },
  })

  await createAuditEvent({ organizationId: doc.packet.organizationId, actorId: user.id as string, action: "PACKET_DOCUMENT_STATUS_CHANGED", targetType: "packet_document", targetId: packetDocumentId, metadata: { packetId: doc.packetId, status } })
  revalidatePath(`/packets/${doc.packetId}`)
  return { success: true as const, data: { id: packetDocumentId } }
}

export async function getProgramsForOrg(orgId: string) {
  await requireOrgAccess(orgId)
  return prisma.program.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })
}
