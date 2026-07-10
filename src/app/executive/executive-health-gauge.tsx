import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { RadialGauge } from "@/components/ui/charts"
import { Progress } from "@/components/ui/progress"
import { readinessLabel } from "@/lib/utils"
import type { HealthTierBreakdown } from "./executive-metrics"

const tierVariant: Record<string, "success" | "default" | "warning" | "danger"> = {
  excellent: "success",
  good: "default",
  needs_attention: "warning",
  at_risk: "danger",
}

export function ComplianceHealthOverviewCard({ score, breakdown }: { score: number | null; breakdown: HealthTierBreakdown[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Compliance Health Overview</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center gap-6 sm:flex-row sm:items-center">
        <RadialGauge value={score ?? 0} size={140} progressClassName="stroke-success-500" trackClassName="stroke-surface-100">
          <span className="text-xl font-bold text-surface-900">{score !== null ? readinessLabel(score) : "—"}</span>
        </RadialGauge>
        <div className="w-full flex-1 space-y-3">
          {breakdown.map((b) => (
            <div key={b.tier}>
              <div className="mb-1 flex justify-between text-xs text-surface-600"><span>{b.label}</span><span>{b.pct}%</span></div>
              <Progress value={b.pct} size="sm" variant={tierVariant[b.tier]} />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
