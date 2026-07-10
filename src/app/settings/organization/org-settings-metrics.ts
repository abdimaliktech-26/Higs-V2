import type { getOrgSettings } from "@/lib/actions/users"
import type { getOrgUsers } from "@/lib/actions/users"
import type { getAuditDashboardSummary } from "@/lib/actions/audit"

type OrgSettings = NonNullable<Awaited<ReturnType<typeof getOrgSettings>>>
type OrgUsers = Awaited<ReturnType<typeof getOrgUsers>>
type AuditSummary = Awaited<ReturnType<typeof getAuditDashboardSummary>>

export interface OrgConfigMetrics {
  configurationCompletionPct: number
  licensedUsersCount: number
  activeUsersCount: number
  eventsLast30Days: number
  defaultPacketType: string | null
  timezone: string | null
  activityTrend: { label: string; count: number }[]
}

const WEEK_MS = 7 * 86400000

function bucketEventsByWeek(events: { createdAt: Date }[], weeks = 5): { label: string; count: number }[] {
  const now = Date.now()
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    label: `W${weeks - i}`,
    start: now - (weeks - i) * WEEK_MS,
    end: now - (weeks - i - 1) * WEEK_MS,
    count: 0,
  }))
  for (const e of events) {
    const t = new Date(e.createdAt).getTime()
    const bucket = buckets.find((b) => t >= b.start && t < b.end)
    if (bucket) bucket.count += 1
  }
  return buckets.map((b) => ({ label: b.label, count: b.count }))
}

/**
 * All values are read directly from getOrgSettings / getOrgUsers /
 * getAuditDashboardSummary — no new Prisma queries or business rules.
 * configurationCompletionPct reuses the same auditReadinessScore already
 * computed by getAuditDashboardSummary (required-document completion).
 */
export function deriveOrgConfigMetrics(org: OrgSettings, members: OrgUsers, auditSummary: AuditSummary): OrgConfigMetrics {
  const settings = (org.settings as Record<string, unknown>) || {}
  return {
    configurationCompletionPct: auditSummary.auditReadinessScore ?? 0,
    licensedUsersCount: members.length,
    activeUsersCount: members.filter((m) => m.status === "ACTIVE").length,
    eventsLast30Days: auditSummary.eventsLast30Days,
    defaultPacketType: (settings.defaultPacketType as string) || null,
    timezone: (settings.timezone as string) || null,
    activityTrend: bucketEventsByWeek(auditSummary.recentEvents),
  }
}
