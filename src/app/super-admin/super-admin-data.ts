import { prisma } from "@/lib/db"
import { requireGlobalSuperAdmin } from "@/lib/live-authorization"

async function requireSuperAdmin(reason: string) {
  return requireGlobalSuperAdmin(reason)
}

export interface PlatformOrganizationRow {
  id: string
  name: string
  slug: string
  status: string
  plan: string
  createdAt: Date
  memberCount: number
  clientCount: number
  packetCount: number
}

/**
 * Cross-tenant read, gated by isSuperAdmin. Mirrors the same
 * prisma.organization.findMany pattern already used per-tenant elsewhere
 * (e.g. org-settings-data.ts), just without an organizationId filter.
 * Read-only — no mutation, no schema change.
 */
export async function getPlatformOrganizations(): Promise<PlatformOrganizationRow[]> {
  await requireSuperAdmin("view platform organizations")
  const orgs = await prisma.organization.findMany({
    orderBy: { createdAt: "desc" },
    include: { _count: { select: { members: true, clients: true, packets: true } } },
  })
  return orgs.map((o) => ({
    id: o.id,
    name: o.name,
    slug: o.slug,
    status: o.status,
    plan: o.plan,
    createdAt: o.createdAt,
    memberCount: o._count.members,
    clientCount: o._count.clients,
    packetCount: o._count.packets,
  }))
}

export interface PlatformActivityEvent {
  id: string
  action: string
  createdAt: Date
  actorName: string | null
  organizationName: string | null
}

export async function getPlatformActivity(limit = 15): Promise<PlatformActivityEvent[]> {
  await requireSuperAdmin("view platform audit activity")
  const events = await prisma.auditEvent.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true } }, organization: { select: { name: true } } },
  })
  return events.map((e) => ({
    id: e.id,
    action: e.action,
    createdAt: e.createdAt,
    actorName: e.actor?.name ?? null,
    organizationName: e.organization?.name ?? null,
  }))
}

export interface PlatformAiUsage {
  extractionsToday: number
  extractionsTotal: number
  openRecommendations: number
}

export async function getPlatformAiUsage(): Promise<PlatformAiUsage> {
  await requireSuperAdmin("view platform AI usage")
  const startOfToday = new Date()
  startOfToday.setHours(0, 0, 0, 0)

  const [extractionsToday, extractionsTotal, openRecommendations] = await Promise.all([
    prisma.aiExtraction.count({ where: { createdAt: { gte: startOfToday } } }),
    prisma.aiExtraction.count(),
    prisma.aiRecommendation.count({ where: { status: "open" } }),
  ])

  return { extractionsToday, extractionsTotal, openRecommendations }
}

export interface PlatformUserTotals {
  totalUsers: number
  totalClients: number
}

export async function getPlatformUserTotals(): Promise<PlatformUserTotals> {
  await requireSuperAdmin("view platform user totals")
  const [totalUsers, totalClients] = await Promise.all([
    prisma.user.count(),
    prisma.client.count(),
  ])
  return { totalUsers, totalClients }
}
