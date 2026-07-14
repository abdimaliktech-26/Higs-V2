"use server"

import { prisma } from "@/lib/db"
import { requireActiveOrganizationMembership } from "@/lib/live-authorization"
import { UserRole, AuditAction } from "@prisma/client"

const VIEW_ALL_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

async function requireAuditScope(orgId: string, reason: string) {
  const authorization = await requireActiveOrganizationMembership(orgId, reason)
  return { authorization, isViewAll: VIEW_ALL_ROLES.includes(authorization.role) }
}

function currentAssignmentWhere(userId: string, now: Date) {
  return {
    some: {
      staffUserId: userId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    },
  }
}

export async function getAuditEvents(orgId: string, params?: {
  action?: string; actorId?: string; targetType?: string; targetId?: string
  search?: string; from?: string; to?: string; page?: number; pageSize?: number
}) {
  const { authorization, isViewAll } = await requireAuditScope(orgId, "list audit events")

  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 50
  const where: Record<string, unknown> = { organizationId: orgId }

  if (!isViewAll) {
    where.actorId = authorization.userId
  }

  if (params?.action) where.action = params.action
  if (params?.actorId && isViewAll) where.actorId = params.actorId
  if (params?.targetType) where.targetType = params.targetType
  if (params?.targetId) where.targetId = params.targetId

  const searchTerm = params?.search?.trim()
  if (searchTerm) {
    // `action` is a Prisma enum (AuditAction) — enums don't support `contains`/`mode`,
    // only exact equality. Only add an action condition when the search term normalizes
    // to a real enum value; otherwise omit it and fall back to the text-field conditions.
    const normalizedAction = searchTerm.toUpperCase().replace(/\s+/g, "_")
    const isValidAction = (Object.values(AuditAction) as string[]).includes(normalizedAction)

    where.OR = [
      { targetType: { contains: searchTerm, mode: "insensitive" } },
      { targetId: { contains: searchTerm, mode: "insensitive" } },
      ...(isValidAction ? [{ action: normalizedAction as AuditAction }] : []),
    ]
  }

  if (params?.from) {
    where.createdAt = { ...(where.createdAt as object || {}), gte: new Date(params.from) as any }
  }
  if (params?.to) {
    where.createdAt = { ...(where.createdAt as object || {}), lte: new Date(params.to) as any }
  }

  const [events, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: { actor: { select: { name: true, email: true } }, organization: { select: { name: true } } },
    }),
    prisma.auditEvent.count({ where: where as any }),
  ])

  return { events, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getAuditEventDetail(eventId: string) {
  const target = await prisma.auditEvent.findUnique({ where: { id: eventId }, select: { organizationId: true, actorId: true } })
  if (!target?.organizationId) return null
  const { authorization, isViewAll } = await requireAuditScope(target.organizationId, "view audit event")
  if (!isViewAll && target.actorId !== authorization.userId) return null

  const event = await prisma.auditEvent.findUnique({
    where: { id: eventId },
    include: { actor: { select: { name: true, email: true } }, organization: { select: { name: true, id: true } } },
  })
  if (!event) return null
  return event
}

export async function getAuditDashboardSummary(orgId: string) {
  const { authorization, isViewAll } = await requireAuditScope(orgId, "view audit dashboard")
  const actorScope = isViewAll ? {} : { actorId: authorization.userId }

  const now = new Date()
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)

  const [totalEvents, recentEvents, recentPhiEvents, packets] = await Promise.all([
    prisma.auditEvent.count({ where: { organizationId: orgId, ...actorScope } }),
    prisma.auditEvent.findMany({
      where: { organizationId: orgId, createdAt: { gte: thirtyDaysAgo }, ...actorScope },
      select: { action: true, createdAt: true },
    }),
    prisma.auditEvent.findMany({
      where: { organizationId: orgId, action: { in: ["CLIENT_VIEWED", "DOCUMENT_VIEWED", "PACKET_VIEWED"] }, ...actorScope },
      orderBy: { createdAt: "desc" }, take: 8,
      include: { actor: { select: { name: true, email: true } } },
    }),
    prisma.packet.findMany({
      where: isViewAll
        ? { organizationId: orgId }
        : { organizationId: orgId, client: { assignments: currentAssignmentWhere(authorization.userId, now) } },
      select: { status: true, documents: { select: { status: true, isRequired: true } } },
    }),
  ])

  const requiredDocs = packets.flatMap((p) => p.documents.filter((d) => d.isRequired))
  const completedDocs = requiredDocs.filter((d) => d.status === "completed")
  const auditReadinessScore = requiredDocs.length ? Math.round((completedDocs.length / requiredDocs.length) * 100) : null

  const evidenceReadyPackets = packets.filter((p) => ["approved", "archived"].includes(p.status)).length

  return {
    totalEvents,
    eventsLast30Days: recentEvents.length,
    recentEvents,
    recentPhiEvents,
    auditReadinessScore,
    packetsTotal: packets.length,
    evidenceReadyPackets,
    isViewAll,
  }
}

export async function getAuditSummary(targetType: string, targetId: string) {
  const target = await prisma.auditEvent.findFirst({
    where: { targetType, targetId, organizationId: { not: null } },
    select: { organizationId: true },
  })
  if (!target?.organizationId) return []
  const { authorization, isViewAll } = await requireAuditScope(target.organizationId, "view resource audit summary")

  const events = await prisma.auditEvent.findMany({
    where: {
      organizationId: target.organizationId,
      targetType,
      targetId,
      ...(isViewAll ? {} : { actorId: authorization.userId }),
    },
    orderBy: { createdAt: "desc" },
    take: 100,
    include: { actor: { select: { name: true } } },
  })
  return events
}
