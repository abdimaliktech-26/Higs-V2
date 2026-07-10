import { Users, UserCheck, FileCheck2, HeartPulse, type LucideIcon } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkline, RadialGauge } from "@/components/ui/charts"
import { readinessLabel, type ReportsOverviewMetrics } from "./reports-metrics"

interface HeroProps {
  metrics: ReportsOverviewMetrics
}

export function ReportingOverviewHero({ metrics }: HeroProps) {
  const trendLabels = metrics.monthlyTrend.map((m) => m.month.slice(5))
  const trendPoints = metrics.monthlyTrend.map((m) => m.count)

  return (
    <Card className="border-navy-800 bg-navy-900 text-white shadow-md">
      <CardContent className="p-6">
        <h2 className="text-base font-semibold text-white">Organization Reporting Overview</h2>

        <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:items-center">
          <div className="flex flex-col items-center gap-2 lg:shrink-0">
            <RadialGauge value={metrics.complianceScore} progressClassName="stroke-success-400">
              <span className="text-3xl font-bold">{metrics.complianceScore}%</span>
              <span className="text-[11px] text-navy-100">Compliance Score</span>
            </RadialGauge>
            <Badge variant="success">{readinessLabel(metrics.complianceScore)}</Badge>
          </div>

          <div className="grid flex-1 grid-cols-1 gap-4 sm:grid-cols-3">
            <HeroStat label="Audit Readiness" value={`${metrics.auditReadinessPct}%`} tone={readinessLabel(metrics.auditReadinessPct)} />
            <HeroStat label="Reports Generated" value="—" tone="This Month" />
            <HeroStat label="Executive Health Score" value={`${metrics.organizationHealthPct}%`} tone={readinessLabel(metrics.organizationHealthPct)} />
          </div>
        </div>

        <div className="mt-6 rounded-lg bg-white/5 p-4">
          <p className="mb-1 text-xs font-medium text-navy-100">Reporting Trend {trendLabels.length > 0 ? `(Last ${trendLabels.length} Months)` : ""}</p>
          <Sparkline points={trendPoints} labels={trendLabels} height={110} />
        </div>
      </CardContent>
    </Card>
  )
}

function HeroStat({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <p className="text-xs font-medium text-navy-100">{label}</p>
      <p className="mt-1 text-2xl font-bold text-white">{value}</p>
      <p className="mt-0.5 text-xs text-navy-200">{tone}</p>
    </div>
  )
}

interface KpiRowProps {
  metrics: ReportsOverviewMetrics
  activeClients: number
}

export function ReportingKpiRow({ metrics, activeClients }: KpiRowProps) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      <KpiCard icon={Users} label="Active Clients" value={activeClients} accent="text-brand-600 bg-brand-50" />
      <KpiCard icon={UserCheck} label="Active Staff" value={metrics.activeStaffCount} accent="text-violet-600 bg-violet-50" />
      <KpiCard icon={FileCheck2} label="Data Completeness" value={`${metrics.dataCompletenessPct}%`} accent="text-sky-600 bg-sky-50" />
      <KpiCard icon={HeartPulse} label="Organization Health" value={`${metrics.organizationHealthPct}%`} accent="text-success-600 bg-success-50" tone={readinessLabel(metrics.organizationHealthPct)} />
    </div>
  )
}

interface KpiCardProps { icon: LucideIcon; label: string; value: string | number; accent: string; tone?: string }

function KpiCard({ icon: Icon, label, value, accent, tone }: KpiCardProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-xs font-medium text-surface-500">{label}</p>
            <p className="mt-1 text-2xl font-bold text-surface-900">{value}</p>
          </div>
          <div className={`flex h-9 w-9 items-center justify-center rounded-lg ${accent}`}>
            <Icon className="h-5 w-5" />
          </div>
        </div>
        {tone && <p className="mt-2 text-xs text-surface-400">{tone}</p>}
      </CardContent>
    </Card>
  )
}
