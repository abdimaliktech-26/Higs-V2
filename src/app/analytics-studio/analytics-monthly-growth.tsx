import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import type { MonthlyClientGrowthPoint } from "./analytics-data"

export function MonthlyClientGrowthCard({ points }: { points: MonthlyClientGrowthPoint[] }) {
  const max = Math.max(...points.map((p) => p.count), 1)

  return (
    <Card>
      <CardHeader><CardTitle>Monthly Client Growth</CardTitle></CardHeader>
      <CardContent>
        <div className="flex h-32 items-end gap-3">
          {points.map((p) => {
            const h = (p.count / max) * 100
            return (
              <div key={p.month} className="flex flex-1 flex-col items-center gap-1">
                <span className="text-xs font-semibold text-surface-700">{p.count}</span>
                <div className="w-full rounded-t-md bg-brand-500 transition-all" style={{ height: `${h}%`, minHeight: 4 }} />
                <span className="text-[10px] text-surface-400">{p.month.slice(5)}</span>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}
