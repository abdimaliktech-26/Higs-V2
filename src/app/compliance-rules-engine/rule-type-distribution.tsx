import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { Donut } from "@/components/ui/charts"
import { Scale } from "lucide-react"
import type { RuleTypeSlice } from "./rules-metrics"

const segmentColors = ["stroke-brand-500", "stroke-sky-400", "stroke-violet-400", "stroke-success-500", "stroke-warning-400", "stroke-danger-400"]

export function RuleTypeDistributionCard({ slices }: { slices: RuleTypeSlice[] }) {
  const total = slices.reduce((s, x) => s + x.count, 0)

  return (
    <Card>
      <CardHeader><CardTitle>Rule Type Distribution</CardTitle></CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState className="py-8" icon={<Scale className="h-6 w-6" />} title="No rules configured yet" />
        ) : (
          <div className="flex items-center gap-6">
            <Donut
              segments={slices.map((s, i) => ({ label: s.category, value: s.count, className: segmentColors[i % segmentColors.length] }))}
              size={140}
              strokeWidth={18}
              centerLabel={<><span className="text-xl font-bold text-surface-900">{total}</span><span className="text-[11px] text-surface-400">Total Rules</span></>}
            />
            <ul className="flex-1 space-y-1.5 text-sm">
              {slices.map((s, i) => (
                <li key={s.category} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${segmentColors[i % segmentColors.length].replace("stroke-", "bg-")}`} />
                    <span className="truncate capitalize text-surface-600">{s.category.replace(/_/g, " ")}</span>
                  </span>
                  <span className="shrink-0 text-xs text-surface-500">{s.count} ({Math.round((s.count / total) * 100)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
