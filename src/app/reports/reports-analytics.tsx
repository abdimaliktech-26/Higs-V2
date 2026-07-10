import type { ReportsData } from "@/lib/actions/reports"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { Sparkline } from "@/components/ui/charts"
import type { ReportsOverviewMetrics } from "./reports-metrics"

interface AnalyticsProps {
  data: ReportsData
  metrics: ReportsOverviewMetrics
}

export function AnalyticsDashboard({ data, metrics }: AnalyticsProps) {
  const trendLabels = metrics.monthlyTrend.map((m) => m.month.slice(5))
  const trendPoints = metrics.monthlyTrend.map((m) => m.count)
  const programNames = (data.reportSpecific.programs as string[] | undefined) ?? []
  const maxStaffCount = Math.max(...data.staffActivity.map((s) => s.eventCount), 1)

  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="mb-4 text-base font-semibold text-surface-900">Analytics Dashboard</h3>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <ChartCard title="Compliance Trend">
            <Sparkline points={trendPoints} labels={trendLabels} height={110} />
          </ChartCard>

          <ChartCard title="Audit Readiness">
            <BigStat value={`${metrics.auditReadinessPct}%`} />
            <Progress value={metrics.auditReadinessPct} size="sm" variant={metrics.auditReadinessPct >= 80 ? "success" : "warning"} className="mt-3" />
          </ChartCard>

          <ChartCard title="Packet Completion">
            <BigStat value={`${metrics.dataCompletenessPct}%`} />
            <Progress value={metrics.dataCompletenessPct} size="sm" variant={metrics.dataCompletenessPct >= 80 ? "success" : "warning"} className="mt-3" />
          </ChartCard>

          <ChartCard title="Signature Completion">
            <BigStat value={`${metrics.signatureCompletionPct}%`} />
            <Progress value={metrics.signatureCompletionPct} size="sm" variant={metrics.signatureCompletionPct >= 80 ? "success" : "warning"} className="mt-3" />
          </ChartCard>

          <ChartCard title="Validation Errors">
            <div className="flex items-end gap-4">
              <div><p className="text-2xl font-bold text-danger-600">{data.validations.criticalIssues}</p><p className="text-xs text-surface-500">Critical</p></div>
              <div><p className="text-2xl font-bold text-warning-600">{data.validations.warningIssues}</p><p className="text-xs text-surface-500">Warnings</p></div>
            </div>
          </ChartCard>

          <ChartCard title="Staff Productivity">
            {data.staffActivity.length === 0 ? (
              <p className="text-xs text-surface-400">No staff activity in the last 30 days</p>
            ) : (
              <div className="space-y-2">
                {data.staffActivity.slice(0, 4).map((s) => (
                  <div key={s.userId} className="flex items-center gap-2">
                    <span className="w-20 truncate text-xs text-surface-600">{s.userName}</span>
                    <Progress value={Math.round((s.eventCount / maxStaffCount) * 100)} size="sm" className="flex-1" />
                    <span className="w-6 text-right text-xs font-semibold text-surface-700">{s.eventCount}</span>
                  </div>
                ))}
              </div>
            )}
          </ChartCard>

          <ChartCard title="Active Programs">
            <p className="text-2xl font-bold text-surface-900">{programNames.length}</p>
            <p className="text-xs text-surface-500">Active</p>
            {programNames.length > 0 && (
              <p className="mt-2 truncate text-xs text-surface-400">{programNames.join(", ")}</p>
            )}
          </ChartCard>
        </div>
      </CardContent>
    </Card>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="border-surface-100 shadow-none">
      <CardHeader className="pb-2"><CardTitle className="text-sm">{title}</CardTitle></CardHeader>
      <CardContent className="pt-0">{children}</CardContent>
    </Card>
  )
}

function BigStat({ value }: { value: string }) {
  return <p className="text-2xl font-bold text-surface-900">{value}</p>
}
