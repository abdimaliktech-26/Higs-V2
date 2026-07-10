import type { getNotifications } from "@/lib/actions/notifications"
import { auditCategories } from "@/app/audit/audit-categories"

type NotificationList = Awaited<ReturnType<typeof getNotifications>>["notifications"]

export interface KpiDef {
  key: string
  label: string
  value: number
  trend: number[]
}

const DAY_MS = 86400000

function last7DaysTrend(items: { createdAt: Date }[]): number[] {
  const now = Date.now()
  return Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (7 - i) * DAY_MS
    const dayEnd = now - (7 - i - 1) * DAY_MS
    return items.filter((n) => {
      const t = new Date(n.createdAt).getTime()
      return t >= dayStart && t < dayEnd
    }).length
  })
}

/**
 * All KPI values and sparklines are derived from the same notifications
 * array already returned by getNotifications (plus the open AI recommendation
 * count) — no new notification types or business rules are introduced.
 */
export function deriveNotificationKpis(notifications: NotificationList, unreadCount: number, openAiRecommendationsCount: number): KpiDef[] {
  const byType = (type: string) => notifications.filter((n) => n.type === type)

  return [
    { key: "unread", label: "Unread Notifications", value: unreadCount, trend: last7DaysTrend(notifications.filter((n) => !n.readAt)) },
    { key: "critical", label: "Critical Alerts", value: byType("validation_failure").length, trend: last7DaysTrend(byType("validation_failure")) },
    { key: "pending_approval", label: "Pending Approvals", value: byType("pending_approval").length, trend: last7DaysTrend(byType("pending_approval")) },
    { key: "pending_signature", label: "Signature Requests", value: byType("pending_signature").length, trend: last7DaysTrend(byType("pending_signature")) },
    { key: "mentions", label: "Mentions", value: 0, trend: [0, 0, 0, 0, 0, 0, 0] },
    { key: "ai", label: "AI Recommendations", value: openAiRecommendationsCount, trend: last7DaysTrend(notifications) },
    { key: "system", label: "System Messages", value: byType("system").length, trend: last7DaysTrend(byType("system")) },
  ]
}

export interface ActivityCategoryCount {
  label: string
  count: number
}

/**
 * Buckets the last-30-days audit events (already fetched by
 * getAuditDashboardSummary) into the existing audit category groups
 * from src/app/audit/audit-categories.ts — same reuse pattern as the
 * Organization Settings pass.
 */
export function deriveActivityAnalytics(recentEvents: { action: string }[]): ActivityCategoryCount[] {
  const categoryFor = (action: string): string => {
    for (const cat of Object.values(auditCategories)) {
      if (cat.actions.includes(action)) return cat.label
    }
    return "Others"
  }

  const counts: Record<string, number> = {}
  for (const e of recentEvents) {
    const label = categoryFor(e.action)
    counts[label] = (counts[label] || 0) + 1
  }

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([label, count]) => ({ label, count }))
}
