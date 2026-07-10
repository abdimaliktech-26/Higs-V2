import { auth } from "@/lib/auth"
import { getPackets, getPacketById } from "@/lib/actions/templates"
import { getSignatureRequests } from "@/lib/actions/signatures"
import { getApprovalRequests } from "@/lib/actions/approvals"
import { getValidationResults } from "@/lib/actions/validation"
import { getAuditDashboardSummary } from "@/lib/actions/audit"
import { getAiRecommendations } from "@/lib/actions/ai"
import { getUpcomingDeadlines } from "@/app/notifications/notifications-data"
import { fromPackets, fromSignatures, fromApprovals, fromValidations, matchesTab, type WorkItem } from "./work-queue-data"
import { deriveWorkQueueKpis, deriveOperationalFocus, deriveWorkloadByAssignee, deriveAvgResolutionHours } from "./work-queue-metrics"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState } from "@/components/ui/states"
import { ListPlus, UserPlus, CheckSquare, Download, MoreHorizontal } from "lucide-react"
import { WorkQueueKpiRow } from "./work-queue-kpi-row"
import { OperationalFocusBar } from "./work-queue-focus-bar"
import { WorkQueueTabs } from "./work-queue-tabs"
import { WorkQueueTable } from "./work-queue-table"
import { WorkQueueInspector } from "./work-queue-inspector"
import { AiWorkAssistantCard, UpcomingComplianceDeadlinesCard, ConfigurationStatusCard } from "./work-queue-sidebar"
import {
  ComplianceWorkOverviewCard, CalendarTimelineCard, TeamWorkloadHeatmapCard, WorkloadAnalyticsCard, WorkQueueQuickActionsCard,
} from "./work-queue-bottom"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId: string; tab?: string; page?: number; focus?: string }

export async function WorkQueueContent({ orgId, tab, page, focus }: Props) {
  const session = await auth()
  const currentUserId = (session?.user as Record<string, unknown> | undefined)?.id as string | undefined

  let packetsRes: Awaited<ReturnType<typeof getPackets>>
  let signaturesRes: Awaited<ReturnType<typeof getSignatureRequests>>
  let approvalsRes: Awaited<ReturnType<typeof getApprovalRequests>>
  let validationsRes: Awaited<ReturnType<typeof getValidationResults>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>
  let upcomingDeadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>

  try {
    [packetsRes, signaturesRes, approvalsRes, validationsRes, auditSummary, aiRecs, upcomingDeadlines] = await Promise.all([
      getPackets(orgId, { pageSize: 100 }),
      getSignatureRequests(orgId, { pageSize: 100 }),
      getApprovalRequests(orgId, { pageSize: 100 }),
      getValidationResults(orgId, { pageSize: 100 }),
      getAuditDashboardSummary(orgId),
      getAiRecommendations(orgId, { status: "open" }),
      getUpcomingDeadlines(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading work queue" description={(e as Error).message} />
  }

  const allItems: WorkItem[] = [
    ...fromPackets(packetsRes.packets),
    ...fromSignatures(signaturesRes.requests),
    ...fromApprovals(approvalsRes.requests),
    ...fromValidations(validationsRes.results),
  ]

  const activeTab = tab || "mine"
  const currentPage = page || 1
  const mine = allItems.filter((i) => matchesTab(i, "mine", currentUserId || ""))
  const filtered = allItems.filter((i) => matchesTab(i, activeTab, currentUserId || ""))

  const tabCounts: Record<string, number> = {}
  for (const t of ["mine", "team", "unassigned", "overdue", "signature", "validation", "approval", "completed"]) {
    tabCounts[t] = allItems.filter((i) => matchesTab(i, t, currentUserId || "")).length
  }

  const kpis = deriveWorkQueueKpis(allItems, mine)
  kpis.avgResolutionHours = deriveAvgResolutionHours(signaturesRes.requests, approvalsRes.requests)
  const focusBar = deriveOperationalFocus(allItems)
  const workload = deriveWorkloadByAssignee(allItems)

  const focusedItem = focus ? allItems.find((i) => i.id === focus) || null : null
  const focusedPacket = focusedItem?.packetId ? await getPacketById(focusedItem.packetId) : null

  const topPriorities = allItems.filter((i) => i.priority === "high")

  return (
    <div className="space-y-6">
      <PageHeader />

      <WorkQueueKpiRow kpis={kpis} />

      <OperationalFocusBar focus={focusBar} />

      <WorkQueueTabs active={activeTab} counts={tabCounts} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,4.9fr)_minmax(0,2.1fr)]">
        <WorkQueueTable items={filtered} tab={activeTab} page={currentPage} focusId={focus} />
        <WorkQueueInspector item={focusedItem} packet={focusedPacket} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
          <ComplianceWorkOverviewCard score={auditSummary.auditReadinessScore} kpis={kpis} />
          <CalendarTimelineCard deadlines={upcomingDeadlines} />
          <TeamWorkloadHeatmapCard workload={workload} />
          <WorkloadAnalyticsCard workload={workload} />
        </div>
        <WorkQueueQuickActionsCard />
      </div>

      <SidebarRow aiRecs={aiRecs} topPriorities={topPriorities} upcomingDeadlines={upcomingDeadlines} />
    </div>
  )
}

function SidebarRow({ aiRecs, topPriorities, upcomingDeadlines }: {
  aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>
  topPriorities: WorkItem[]
  upcomingDeadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>
}) {
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <AiWorkAssistantCard topPriorities={topPriorities} recommendations={aiRecs} />
      <UpcomingComplianceDeadlinesCard deadlines={upcomingDeadlines} />
      <ConfigurationStatusCard />
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Task &amp; Work Queue</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">Your daily operational hub for packets, signatures, approvals, and validation work.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><ListPlus className="h-4 w-4" /> Create Task</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><UserPlus className="h-4 w-4" /> Assign Work</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><CheckSquare className="h-4 w-4" /> Bulk Actions</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export Tasks</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[{ value: "settings", label: "Queue Settings", disabled: true }]}
        />
      </div>
    </div>
  )
}
