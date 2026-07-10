"use server"

import { prisma } from "@/lib/db"
import {  } from "@/lib/validation"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { UserRole } from "@prisma/client"

const FULL_REPORT_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

export interface ReportFilters {
  from?: string; to?: string; program?: string; packetType?: string; staffId?: string; status?: string
}

interface ScopedWhere {
  client?: Record<string, unknown>
  organizationId?: string
  assignments?: Record<string, unknown>
}

function getBaseWhere(orgId: string, isFullAccess: boolean, userId: string, filters?: ReportFilters): ScopedWhere {
  const where: ScopedWhere = { organizationId: orgId }
  if (!isFullAccess) {
    where.assignments = { some: { staffUserId: userId } }
  }
  return where
}

function getDateFilter(filters?: ReportFilters): Record<string, Date> | undefined {
  const dateFilter: Record<string, Date> = {}
  if (filters?.from) dateFilter.gte = new Date(filters.from)
  if (filters?.to) dateFilter.lte = new Date(filters.to)
  return Object.keys(dateFilter).length ? dateFilter : undefined
}

export interface ReportsData {
  clients: { total: number; active: number; archived: number; byProgram: { program: string; count: number }[] }
  packets: { total: number; byStatus: Record<string, number>; byType: Record<string, number>; overdue: number; completed: number }
  documents: { total: number; pending: number; inProgress: number; completed: number }
  validations: { total: number; avgScore: number; criticalIssues: number; warningIssues: number }
  signatures: { total: number; pending: number; completed: number; declined: number }
  approvals: { total: number; pending: number; approved: number; rejected: number }
  staffActivity: { userId: string; userName: string; eventCount: number }[]
  monthlyCompletion: { month: string; count: number }[]
  reportSpecific: Record<string, unknown>
}

export async function getReportsData(orgId: string, filters?: ReportFilters): Promise<ReportsData> {
  const user = await requireOrgAccess(orgId)
  const role = getActiveRole(user as any)
  const isSuperAdmin = user.isSuperAdmin as boolean
  const isFullAccess = isSuperAdmin || FULL_REPORT_ROLES.includes(role)
  const userId = user.id

  const baseWhere = getBaseWhere(orgId, isFullAccess, userId)
  const basePacketWhere: Record<string, unknown> = { organizationId: orgId }
  if (!isFullAccess) basePacketWhere.client = { assignments: { some: { staffUserId: userId } } }

  const dateFilter = getDateFilter(filters)
  if (dateFilter) basePacketWhere.createdAt = dateFilter

  const [clients, packets, documents, validations, signatures, approvals, supportingDocs, auditEvents, programs] = await Promise.all([
    prisma.client.groupBy({ by: ["status"], where: { organizationId: orgId } as any, _count: true }),
    prisma.packet.findMany({ where: basePacketWhere, select: { status: true, dueDate: true, completedAt: true, packetType: true, createdAt: true, clientId: true } }),
    prisma.packetDocument.findMany({ where: { packet: basePacketWhere as any }, select: { status: true } }),
    prisma.validationResult.findMany({ where: { packet: basePacketWhere as any }, select: { score: true, criticalCount: true, warningCount: true }, orderBy: { ranAt: "desc" } }),
    prisma.signatureRequest.findMany({ where: { organizationId: orgId }, select: { status: true } }),
    prisma.approvalRequest.findMany({ where: { organizationId: orgId }, select: { status: true } }),
    prisma.supportingDocument.count({ where: { organizationId: orgId } }),
    prisma.auditEvent.groupBy({ by: ["actorId"], where: { organizationId: orgId, createdAt: { gte: new Date(Date.now() - 30 * 86400000) } }, _count: true, orderBy: { _count: { id: "desc" } }, take: 10 }),
    prisma.program.findMany({ where: { organizationId: orgId, isActive: true }, select: { id: true, name: true, code: true } }),
  ])

  const totalClients = clients.reduce((s, c) => s + c._count, 0)
  const activeCount = clients.find(c => c.status === "active")?._count ?? 0
  const archivedCount = clients.find(c => c.status === "archived")?._count ?? 0

  const byStatus: Record<string, number> = {}
  const byType: Record<string, number> = {}
  let overdue = 0; let completed = 0
  for (const p of packets) {
    byStatus[p.status] = (byStatus[p.status] || 0) + 1
    byType[p.packetType] = (byType[p.packetType] || 0) + 1
    if (p.dueDate && new Date(p.dueDate) < new Date() && p.status !== "approved" && p.status !== "archived") overdue++
    if (p.completedAt || p.status === "approved" || p.status === "archived") completed++
  }

  const actorIds = auditEvents.map(e => e.actorId).filter(Boolean) as string[]
  const actors = actorIds.length > 0 ? await prisma.user.findMany({ where: { id: { in: actorIds } }, select: { id: true, name: true } }) : []

  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000)
  const completedPackets = packets.filter(p => p.completedAt && new Date(p.completedAt) >= sixMonthsAgo)
  const monthMap: Record<string, number> = {}
  for (const p of completedPackets) {
    const key = p.completedAt!.toISOString().slice(0, 7)
    monthMap[key] = (monthMap[key] || 0) + 1
  }

  await createAuditEvent({
    organizationId: orgId, actorId: userId,
    action: "EXPORT_PERFORMED", targetType: "report", metadata: { reportType: "dashboard", ...filters },
  })

  return {
    clients: { total: totalClients, active: activeCount, archived: archivedCount, byProgram: [] },
    packets: { total: packets.length, byStatus, byType, overdue, completed },
    documents: { total: documents.length, pending: documents.filter(d => d.status === "pending").length, inProgress: documents.filter(d => d.status === "in_progress").length, completed: documents.filter(d => d.status === "completed").length },
    validations: { total: validations.length, avgScore: validations.length > 0 ? Math.round(validations.reduce((s, v) => s + v.score, 0) / validations.length) : 0, criticalIssues: validations.reduce((s, v) => s + v.criticalCount, 0), warningIssues: validations.reduce((s, v) => s + v.warningCount, 0) },
    signatures: { total: signatures.length, pending: signatures.filter(s => ["pending", "sent", "viewed"].includes(s.status)).length, completed: signatures.filter(s => s.status === "signed").length, declined: signatures.filter(s => s.status === "declined").length },
    approvals: { total: approvals.length, pending: approvals.filter(a => a.status === "pending").length, approved: approvals.filter(a => a.status === "approved").length, rejected: approvals.filter(a => a.status === "rejected").length },
    staffActivity: auditEvents.map(e => ({ userId: e.actorId ?? "", userName: actors.find(a => a.id === e.actorId)?.name || "Unknown", eventCount: e._count })).slice(0, 8),
    monthlyCompletion: Object.entries(monthMap).sort().map(([month, count]) => ({ month, count })),
    reportSpecific: { programs: programs.map(p => p.name), supportingDocs, memberCount: totalClients, staffUserIds: actorIds, staffNames: actors },
  }
}
