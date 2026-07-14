"use server"

import { revalidatePath } from "next/cache"
import { validate, createClientSchema, clientQuerySchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { createAuditEvent } from "@/lib/audit"
import {
  ASSIGNMENT_SCOPED_CLIENT_ROLES,
  CLIENT_ASSIGNMENT_ROLES,
  CLIENT_CREATION_ROLES,
  CLIENT_READ_ROLES,
  getLiveStaffAuthorizationContext,
  requireActiveOrganizationMembership,
  requireActiveAssignableStaff,
  requireClientAccess,
  requireOrganizationRole,
} from "@/lib/live-authorization"

export type ClientActionResult = { success: true; data: { id: string } } | { success: false; error: string }

export async function getClients(orgId: string, raw: Record<string, unknown> = {}) {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "list clients in organization")
  const role = authorization.role
  const parsed = validate(clientQuerySchema, raw)
  const params = parsed.success ? parsed.data : { page: 1, pageSize: 20 }
  const page = params.page; const pageSize = params.pageSize

  const where: Record<string, unknown> = { organizationId: orgId }
  if (raw.search) {
    const s = String(raw.search)
    where.OR = [
      { firstName: { contains: s, mode: "insensitive" } },
      { lastName: { contains: s, mode: "insensitive" } },
      { mcadId: { contains: s, mode: "insensitive" } },
      { email: { contains: s, mode: "insensitive" } },
    ]
  }
  if (raw.status && raw.status !== "all") where.status = raw.status
  if (raw.program) where.enrollments = { some: { programId: raw.program } }
  if (raw.packetStatus) where.packets = { some: { status: String(raw.packetStatus) } }

  if (ASSIGNMENT_SCOPED_CLIENT_ROLES.includes(role)) {
    // Tenant/role scoping always wins — a filter value can never widen this beyond the user's own clients.
    where.assignments = { some: { staffUserId: authorization.userId } }
  } else if (raw.caseManager) {
    where.assignments = { some: { staffUserId: String(raw.caseManager) } }
  }

  const [clients, total] = await Promise.all([
    prisma.client.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        enrollments: { include: { program: true } },
        diagnoses: { where: { isActive: true } },
        assignments: { include: { staff: { select: { id: true, name: true, email: true } } } },
        packets: {
          orderBy: { updatedAt: "desc" },
          select: {
            id: true, status: true, packetType: true, dueDate: true, completedAt: true, updatedAt: true,
            documents: { select: { status: true, isRequired: true } },
            validationResults: { select: { criticalCount: true, warningCount: true }, orderBy: { ranAt: "desc" }, take: 1 },
          },
        },
        _count: { select: { packets: true } },
      },
    }),
    prisma.client.count({ where: where as any }),
  ])
  return { clients, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getClientById(clientId: string) {
  await requireClientAccess(clientId, "read", "view client details")
  const client = await prisma.client.findUnique({
    where: { id: clientId },
    include: {
      enrollments: { include: { program: true } },
      diagnoses: { where: { isActive: true } },
      contacts: true,
      assignments: { include: { staff: { select: { id: true, name: true, email: true } } } },
      packets: { orderBy: { createdAt: "desc" }, take: 10 },
      organization: { select: { name: true, id: true } },
    },
  })
  if (!client) return null
  return client
}

export async function createClient(raw: Record<string, unknown>): Promise<ClientActionResult> {
  const parsed = validate(createClientSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  try {
    const identity = await getLiveStaffAuthorizationContext()
    const orgId = identity.selectedOrganizationId ?? undefined
    if (!orgId) return { success: false, error: "No organization selected" }
    const authorization = await requireOrganizationRole(orgId, CLIENT_CREATION_ROLES, "create client in selected organization")

    const client = await prisma.client.create({
      data: {
        organizationId: orgId,
        firstName: data.firstName, lastName: data.lastName,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth) : null,
        email: data.email || null, phone: data.phone || null,
        address: data.address || null, city: data.city || null,
        state: data.state || null, zipCode: data.zipCode || null,
        mcadId: data.mcadId || null,
        gender: data.gender || null, preferredLanguage: data.preferredLanguage || null,
        fundingSource: data.fundingSource || null, status: data.status || "active",
        notes: data.notes || null,
      },
    })
    await createAuditEvent({
      organizationId: orgId, actorId: authorization.userId,
      action: "CLIENT_CREATED", targetType: "client", targetId: client.id,
      metadata: { clientName: `${client.firstName} ${client.lastName}` },
    })
    revalidatePath("/clients")
    return { success: true, data: { id: client.id } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to create client" }
  }
}

export async function updateClient(clientId: string, raw: Record<string, unknown>): Promise<ClientActionResult> {
  const parsed = validate(createClientSchema.partial(), raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  try {
    const existing = await prisma.client.findUnique({ where: { id: clientId } })
    if (!existing) return { success: false, error: "Client not found" }
    const authorization = await requireClientAccess(clientId, "manage", "update client")

    const data = parsed.data as Record<string, unknown>
    const client = await prisma.client.update({
      where: { id: clientId },
      data: {
        ...data,
        dateOfBirth: data.dateOfBirth ? new Date(data.dateOfBirth as string) : undefined,
      } as any,
    })
    await createAuditEvent({
      organizationId: existing.organizationId, actorId: authorization.userId,
      action: "CLIENT_UPDATED", targetType: "client", targetId: clientId,
      metadata: { clientName: `${client.firstName} ${client.lastName}` },
    })
    revalidatePath(`/clients/${clientId}`); revalidatePath("/clients")
    return { success: true, data: { id: client.id } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to update client" }
  }
}

export async function archiveClient(clientId: string, reason?: string): Promise<ClientActionResult> {
  try {
    const existing = await prisma.client.findUnique({ where: { id: clientId } })
    if (!existing) return { success: false, error: "Client not found" }
    const authorization = await requireClientAccess(clientId, "archive", "archive client")

    await prisma.client.update({
      where: { id: clientId },
      data: { status: "archived", archivedAt: new Date(), archivedReason: reason || null },
    })
    await createAuditEvent({
      organizationId: existing.organizationId, actorId: authorization.userId,
      action: "CLIENT_ARCHIVED", targetType: "client", targetId: clientId,
      metadata: { clientName: `${existing.firstName} ${existing.lastName}`, reason },
    })
    revalidatePath("/clients")
    return { success: true, data: { id: clientId } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to archive client" }
  }
}

export async function getPrograms(orgId: string) {
  await requireActiveOrganizationMembership(orgId, "list organization programs for client workflow")
  return prisma.program.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })
}

export async function getAvailableStaff(orgId: string) {
  await requireOrganizationRole(orgId, CLIENT_ASSIGNMENT_ROLES, "list staff available for client assignment")
  const members = await prisma.organizationMember.findMany({
    where: { organizationId: orgId, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true } } },
  })
  return members.map((m) => ({ id: m.user.id, name: m.user.name, email: m.user.email, role: m.role }))
}

export async function assignStaff(clientId: string, staffUserId: string, role: string, isPrimary: boolean): Promise<ClientActionResult> {
  try {
    const client = await prisma.client.findUnique({ where: { id: clientId } })
    if (!client) return { success: false, error: "Client not found" }
    const authorization = await requireOrganizationRole(client.organizationId, CLIENT_ASSIGNMENT_ROLES, "assign staff to client")
    await requireActiveAssignableStaff(client.organizationId, staffUserId)
    await prisma.staffAssignment.upsert({
      where: { clientId_staffUserId_role: { clientId, staffUserId, role } },
      update: { isPrimary, endDate: null },
      create: { clientId, staffUserId, role, isPrimary, startDate: new Date() },
    })
    await createAuditEvent({
      organizationId: client.organizationId, actorId: authorization.userId,
      action: "STAFF_ASSIGNED", targetType: "assignment", targetId: clientId,
      metadata: { staffUserId, role },
    })
    revalidatePath(`/clients/${clientId}`)
    return { success: true, data: { id: clientId } }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : "Failed to assign staff" }
  }
}

export type BulkActionResult = { success: true; count: number } | { success: false; error: string }

export async function bulkArchiveClients(clientIds: string[]): Promise<BulkActionResult> {
  if (clientIds.length === 0) return { success: false, error: "No clients selected" }
  let count = 0
  for (const id of clientIds) {
    const result = await archiveClient(id, "Bulk archive from Clients list")
    if (!result.success) return { success: false, error: result.error }
    count++
  }
  revalidatePath("/clients")
  return { success: true, count }
}

export async function bulkAssignCaseManager(clientIds: string[], staffUserId: string): Promise<BulkActionResult> {
  if (clientIds.length === 0) return { success: false, error: "No clients selected" }
  let count = 0
  for (const id of clientIds) {
    const result = await assignStaff(id, staffUserId, "case_manager", true)
    if (!result.success) return { success: false, error: result.error }
    count++
  }
  revalidatePath("/clients")
  return { success: true, count }
}
