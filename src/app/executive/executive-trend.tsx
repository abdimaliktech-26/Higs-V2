import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Sparkline } from "@/components/ui/charts"
import type { TrendPoint } from "./executive-metrics"

export function ComplianceTrendCard({ trend }: { trend: TrendPoint[] }) {
  const passPoints = trend.map((t) => t.passRatePct)
  const failPoints = trend.map((t) => 100 - t.passRatePct)
  const labels = trend.map((t) => t.label)
  const hasData = trend.some((t) => t.passRatePct > 0)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Compliance Trend (90 Days)</CardTitle>
        <div className="mt-1 flex items-center gap-4 text-xs text-surface-500">
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-brand-500" /> Pass Rate</span>
          <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-danger-500" /> Fail Rate</span>
        </div>
      </CardHeader>
      <CardContent>
        {hasData ? (
          <div className="relative">
            <Sparkline points={passPoints} labels={labels} height={160} stroke="#3b82f6" fill="rgba(59,130,246,0.08)" />
            <div className="absolute inset-0">
              <Sparkline points={failPoints} height={160} stroke="#ef4444" fill="transparent" />
            </div>
          </div>
        ) : (
          <div className="flex h-40 items-center justify-center text-sm text-surface-400">No validation runs in this window yet</div>
        )}
      </CardContent>
    </Card>
  )
}
