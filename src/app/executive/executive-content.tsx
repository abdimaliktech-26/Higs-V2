import { getAuditDashboardSummary } from "@/lib/actions/audit"
import { getValidationResults } from "@/lib/actions/validation"
import { getSignatureRequests } from "@/lib/actions/signatures"
import { getPackets } from "@/lib/actions/templates"
import { getClients } from "@/lib/actions/client"
import { getAiRecommendations } from "@/lib/actions/ai"
import {
  deriveComplianceKpis, deriveComplianceTrend, deriveHealthTierBreakdown, deriveStrategicRisks, deriveLeadershipFocus,
} from "./executive-metrics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Download, CalendarClock, Share2, MoreHorizontal, Calendar, Building2 } from "lucide-react"
import { ExecutiveKpiRow } from "./executive-kpi-row"
import { ComplianceTrendCard } from "./executive-trend"
import { RiskByLocationCard } from "./executive-risk-location"
import { ComplianceHealthOverviewCard } from "./executive-health-gauge"
import { TopStrategicRisksCard } from "./executive-strategic-risks"
import { AiInsightsCard, LeadershipFocusCard } from "./executive-ai-insights"
import { ExecutiveBottomStatus } from "./executive-bottom-status"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId?: string; orgName?: string; isSuperAdmin: boolean }

export async function ExecutiveContent({ orgId, orgName, isSuperAdmin }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <PageHeader orgName={orgName} />
        <div className="rounded-xl border border-surface-200 bg-white p-16">
          <EmptyState title="Switch to an organization" description="Select an organization to view its Executive Command Center." icon={<Building2 className="h-8 w-8" />} />
        </div>
      </div>
    )
  }
  if (!orgId) return null

  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let validationRes: Awaited<ReturnType<typeof getValidationResults>>
  let signaturesRes: Awaited<ReturnType<typeof getSignatureRequests>>
  let packetsRes: Awaited<ReturnType<typeof getPackets>>
  let clientsRes: Awaited<ReturnType<typeof getClients>>
  let aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>

  try {
    [auditSummary, validationRes, signaturesRes, packetsRes, clientsRes, aiRecs] = await Promise.all([
      getAuditDashboardSummary(orgId),
      getValidationResults(orgId, { pageSize: 100 }),
      getSignatureRequests(orgId, { pageSize: 100 }),
      getPackets(orgId, { pageSize: 100 }),
      getClients(orgId, { status: "active", pageSize: 1 }),
      getAiRecommendations(orgId, { status: "open" }),
    ])
  } catch (e) {
    return <ErrorState title="Error loading executive command center" description={(e as Error).message} />
  }

  const kpis = deriveComplianceKpis(validationRes.results, clientsRes.total)
  const trend = deriveComplianceTrend(validationRes.results)
  const healthBreakdown = deriveHealthTierBreakdown(validationRes.results)
  const strategicRisks = deriveStrategicRisks(signaturesRes.requests, packetsRes.packets, validationRes.results)
  const leadershipFocus = deriveLeadershipFocus(aiRecs.slice(0, 2).map((r) => r.message), strategicRisks)
  const lastAuditAt = validationRes.results[0]?.ranAt ?? null

  return (
    <div className="space-y-6">
      <PageHeader orgName={orgName} />

      <ExecutiveKpiRow auditReadinessScore={auditSummary.auditReadinessScore} passRatePct={kpis.passRatePct} clientsServed={kpis.clientsServed} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ComplianceTrendCard trend={trend} />
        <RiskByLocationCard />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ComplianceHealthOverviewCard score={auditSummary.auditReadinessScore} breakdown={healthBreakdown} />
        <TopStrategicRisksCard risks={strategicRisks} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <AiInsightsCard recommendations={aiRecs} />
        <LeadershipFocusCard items={leadershipFocus} />
      </div>

      <ExecutiveBottomStatus auditReadinessScore={auditSummary.auditReadinessScore} lastAuditAt={lastAuditAt} />
    </div>
  )
}

function PageHeader({ orgName }: { orgName?: string }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Executive Command Center</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">Strategic overview of organizational health, compliance posture, and operational performance.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {orgName && <Badge variant="secondary" size="md">{orgName}</Badge>}
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Calendar className="h-4 w-4" /> Last 90 Days</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><CalendarClock className="h-4 w-4" /> Schedule</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Share2 className="h-4 w-4" /> Share</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[{ value: "settings", label: "Report Settings", disabled: true }]}
        />
      </div>
    </div>
  )
}
