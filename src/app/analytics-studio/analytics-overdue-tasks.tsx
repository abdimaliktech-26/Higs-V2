import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import type { StrategicRisk } from "@/app/executive/executive-metrics"

const barVariant: Record<string, "danger" | "warning" | "default"> = { high: "danger", medium: "warning", low: "default" }

export function OverdueTasksCard({ risks }: { risks: StrategicRisk[] }) {
  const counts = risks.map((r) => ({ ...r, count: r.available ? parseInt(r.detail, 10) || 0 : 0 }))
  const max = Math.max(...counts.map((r) => r.count), 1)

  return (
    <Card>
      <CardHeader><CardTitle>Overdue Tasks</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {counts.map((r) => (
          <div key={r.label}>
            <div className="mb-1 flex justify-between text-xs text-surface-600">
              <span>{r.label}</span>
              <span className={r.available ? "font-medium text-surface-900" : "text-surface-400"}>{r.available ? r.count : "Coming soon"}</span>
            </div>
            {r.available && <Progress value={Math.round((r.count / max) * 100)} size="sm" variant={barVariant[r.severity]} />}
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
