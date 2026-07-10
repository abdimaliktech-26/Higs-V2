import { getClients } from "@/lib/actions/client"
import { getValidationResults } from "@/lib/actions/validation"
import { getSignatureRequests } from "@/lib/actions/signatures"
import { getPackets } from "@/lib/actions/templates"
import { getAiRecommendations } from "@/lib/actions/ai"
import { getClientsByProgram, getMonthlyClientGrowth } from "./analytics-data"
import { deriveComplianceKpis, deriveComplianceTrend, deriveStrategicRisks } from "@/app/executive/executive-metrics"
import { ComplianceTrendCard } from "@/app/executive/executive-trend"
import { ReportLibrary } from "@/app/reports/reports-library"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { LayoutDashboard, FileBarChart, CalendarClock, MoreHorizontal, Building2 } from "lucide-react"
import { AnalyticsKpiRow } from "./analytics-kpi-row"
import { DashboardLibraryCard } from "./analytics-dashboard-library"
import { ClientsByProgramCard } from "./analytics-clients-by-program"
import { OverdueTasksCard } from "./analytics-overdue-tasks"
import { MonthlyClientGrowthCard } from "./analytics-monthly-growth"
import { AnalyticsAiInsightsCard } from "./analytics-ai-insights"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId?: string; isSuperAdmin: boolean }

export async function AnalyticsStudioContent({ orgId, isSuperAdmin }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-xl border border-surface-200 bg-white p-16">
          <EmptyState title="Switch to an organization" description="Select an organization to view its Analytics Studio." icon={<Building2 className="h-8 w-8" />} />
        </div>
      </div>
    )
  }
  if (!orgId) return null

  let clientsRes: Awaited<ReturnType<typeof getClients>>
  let validationRes: Awaited<ReturnType<typeof getValidationResults>>
  let signaturesRes: Awaited<ReturnType<typeof getSignatureRequests>>
  let packetsRes: Awaited<ReturnType<typeof getPackets>>
  let aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>
  let programs: Awaited<ReturnType<typeof getClientsByProgram>>
  let growth: Awaited<ReturnType<typeof getMonthlyClientGrowth>>

  try {
    [clientsRes, validationRes, signaturesRes, packetsRes, aiRecs, programs, growth] = await Promise.all([
      getClients(orgId, { status: "active", pageSize: 1 }),
      getValidationResults(orgId, { pageSize: 100 }),
      getSignatureRequests(orgId, { pageSize: 100 }),
      getPackets(orgId, { pageSize: 100 }),
      getAiRecommendations(orgId, { status: "open" }),
      getClientsByProgram(orgId),
      getMonthlyClientGrowth(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading Analytics Studio" description={(e as Error).message} />
  }

  const kpis = deriveComplianceKpis(validationRes.results, clientsRes.total)
  const trend = deriveComplianceTrend(validationRes.results)
  const risks = deriveStrategicRisks(signaturesRes.requests, packetsRes.packets, validationRes.results)

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,3.2fr)]">
        <DashboardLibraryCard />

        <div className="space-y-6">
          <AnalyticsKpiRow clientsServed={kpis.clientsServed} passRatePct={kpis.passRatePct} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <ComplianceTrendCard trend={trend} />
            <ClientsByProgramCard programs={programs} />
          </div>

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <MonthlyClientGrowthCard points={growth} />
            <OverdueTasksCard risks={risks} />
          </div>

          <AnalyticsAiInsightsCard recommendations={aiRecs} />

          <ReportLibrary />
        </div>
      </div>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Analytics Studio</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">Build custom dashboards, reports, and KPIs with advanced analytics.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><LayoutDashboard className="h-4 w-4" /> New Dashboard</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><FileBarChart className="h-4 w-4" /> Report Builder</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><CalendarClock className="h-4 w-4" /> Schedule Report</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[{ value: "settings", label: "Dashboard Settings", disabled: true }]}
        />
      </div>
    </div>
  )
}
