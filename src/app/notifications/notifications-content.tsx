import { getNotifications } from "@/lib/actions/notifications"
import { getOrgUsers } from "@/lib/actions/users"
import { getAuditDashboardSummary } from "@/lib/actions/audit"
import { getAiRecommendations } from "@/lib/actions/ai"
import { getNotificationFocusPacket, getUpcomingDeadlines } from "./notifications-data"
import { deriveNotificationKpis, deriveActivityAnalytics } from "./notifications-metrics"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState } from "@/components/ui/states"
import { Megaphone, Settings2, Download, History, MoreHorizontal, Mail, Lightbulb } from "lucide-react"
import { NotificationsKpiRow } from "./notifications-kpi-row"
import { NotificationsFilterTabs, filterTabs } from "./notifications-filters"
import { NotificationsTimeline, GenerateAlertsButton } from "./notifications-timeline"
import { NotificationsFocusPanel } from "./notifications-focus-panel"
import { HigsiAiAssistantCard, CommunicationStatusCard, NotificationsQuickActionsCard } from "./notifications-sidebar"
import {
  AnnouncementsCard, DailyDigestCard, UpcomingDeadlinesCard, SearchNotificationsCard,
  ActivityAnalyticsCard, NotificationSettingsShortcutCard,
} from "./notifications-bottom-grid"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId: string; filter?: string; focus?: string; q?: string }

function matchesFilter(type: string, readAt: Date | null, filter: string): boolean {
  switch (filter) {
    case "unread": return !readAt
    case "critical": return type === "validation_failure" || type === "overdue"
    case "approvals": return type === "pending_approval"
    case "signatures": return type === "pending_signature"
    case "validation": return type === "validation_failure"
    case "system": return type === "system"
    case "audit": case "tasks": case "mentions": case "messages": return false
    default: return true
  }
}

export async function NotificationsContent({ orgId, filter, focus, q }: Props) {
  const activeFilter = filter || "all"

  let base: Awaited<ReturnType<typeof getNotifications>>
  let members: Awaited<ReturnType<typeof getOrgUsers>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>
  let upcomingDeadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>

  try {
    [base, members, auditSummary, aiRecs, upcomingDeadlines] = await Promise.all([
      getNotifications(orgId, { unreadOnly: false }),
      getOrgUsers(orgId),
      getAuditDashboardSummary(orgId),
      getAiRecommendations(orgId, { status: "open" }),
      getUpcomingDeadlines(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading notifications" description={(e as Error).message} />
  }

  const tabCounts: Record<string, number> = { all: base.total, unread: base.unreadCount }
  for (const tab of filterTabs) {
    if (tab.id === "all" || tab.id === "unread") continue
    tabCounts[tab.id] = tab.id === "ai" ? aiRecs.length : base.notifications.filter((n) => matchesFilter(n.type, n.readAt, tab.id)).length
  }

  let filtered = activeFilter === "ai" ? [] : base.notifications.filter((n) => matchesFilter(n.type, n.readAt, activeFilter))
  if (q) {
    const needle = q.toLowerCase()
    filtered = filtered.filter((n) => n.title.toLowerCase().includes(needle) || n.message.toLowerCase().includes(needle))
  }

  const focusedNotification = focus
    ? base.notifications.find((n) => n.id === focus) || null
    : filtered[0] || null
  const focusMeta = (focusedNotification?.metadata as Record<string, unknown>) || {}
  const focusPacket = await getNotificationFocusPacket(orgId, focusMeta.packetId as string | undefined)

  const kpis = deriveNotificationKpis(base.notifications, base.unreadCount, aiRecs.length)
  const activityCategories = deriveActivityAnalytics(auditSummary.recentEvents)

  return (
    <div className="space-y-6">
      <PageHeader orgId={orgId} />

      <NotificationsKpiRow kpis={kpis} />

      <NotificationsFilterTabs active={activeFilter} counts={tabCounts} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            {activeFilter === "ai" ? (
              <div className="lg:col-span-2">
                <AiRecommendationsPanel recommendations={aiRecs} />
              </div>
            ) : (
              <>
                <NotificationsTimeline notifications={filtered} focusId={focusedNotification?.id} />
                <NotificationsFocusPanel notification={focusedNotification} packet={focusPacket} />
              </>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <HigsiAiAssistantCard recommendations={aiRecs} />
          <CommunicationStatusCard members={members.map((m) => ({ id: m.id, user: { name: m.user.name, email: m.user.email } }))} />
          <NotificationsQuickActionsCard />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-3">
        <AnnouncementsCard />
        <DailyDigestCard />
        <UpcomingDeadlinesCard deadlines={upcomingDeadlines} />
        <SearchNotificationsCard query={q} />
        <ActivityAnalyticsCard categories={activityCategories} total={auditSummary.eventsLast30Days} />
        <NotificationSettingsShortcutCard />
      </div>

      <PreferencesAndTemplates />
    </div>
  )
}

function PageHeader({ orgId }: { orgId: string }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Notifications &amp; Communication Center</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">
          Monitor alerts, approvals, signatures, communication, compliance, and AI recommendations from one centralized workspace.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><Megaphone className="h-4 w-4" /> Create Announcement</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Mark All Read</Button>
        <a href="#preferences"><Button variant="secondary" size="sm"><Settings2 className="h-4 w-4" /> Notification Settings</Button></a>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export Activity</Button>
        <GenerateAlertsButton orgId={orgId} />
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[
            { value: "history", label: "Settings History", icon: <History className="h-4 w-4" />, disabled: true },
          ]}
        />
      </div>
    </div>
  )
}

function AiRecommendationsPanel({ recommendations }: { recommendations: { id: string; message: string; type: string; confidence: number }[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Recommendations</CardTitle><CardDescription>Open recommendations across the organization</CardDescription></CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <p className="text-sm text-surface-400">No open recommendations right now.</p>
        ) : (
          <ul className="space-y-3">
            {recommendations.map((r) => (
              <li key={r.id} className="flex items-start gap-3 rounded-lg border border-surface-100 p-3">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-surface-800">{r.message}</p>
                  <Badge variant="secondary" size="sm" className="mt-1">{r.type}</Badge>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function PreferencesAndTemplates() {
  return (
    <div id="preferences" className="grid gap-6 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Settings2 className="h-5 w-5 text-surface-400" />
            <CardTitle>Notification Preferences</CardTitle>
            <CardDescription>Configure which alerts you receive</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { type: "overdue", label: "Overdue Packets" },
              { type: "validation_failure", label: "Validation Failures" },
              { type: "pending_signature", label: "Pending Signatures" },
              { type: "pending_approval", label: "Pending Approvals" },
            ].map((p) => (
              <div key={p.type} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
                <span className="text-sm text-surface-700">{p.label}</span>
                <span className="text-xs text-surface-400 bg-surface-100 px-2 py-0.5 rounded">Always on</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Mail className="h-5 w-5 text-surface-400" />
            <CardTitle>Message Templates</CardTitle>
            <CardDescription>Pre-defined notification message templates</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { name: "Overdue Notice", desc: "Standard overdue packet notification" },
              { name: "Validation Alert", desc: "Validation failure with issue summary" },
              { name: "Signature Request", desc: "Signature needed notification" },
              { name: "Approval Needed", desc: "Approval pending notification" },
            ].map((t) => (
              <div key={t.name} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
                <div>
                  <p className="text-sm font-medium text-surface-900">{t.name}</p>
                  <p className="text-xs text-surface-500">{t.desc}</p>
                </div>
                <Button variant="ghost" size="sm" disabled title={NOT_WIRED}>Edit</Button>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
