import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import type { StrategicRisk } from "./executive-metrics"

const dotColor: Record<string, string> = { high: "bg-danger-500", medium: "bg-warning-500", low: "bg-success-500" }

export function TopStrategicRisksCard({ risks }: { risks: StrategicRisk[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Top Strategic Risks</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {risks.map((r) => (
            <li key={r.label} className="flex items-center gap-3 text-sm">
              <span className={`h-2 w-2 shrink-0 rounded-full ${r.available ? dotColor[r.severity] : "bg-surface-200"}`} />
              <span className={`min-w-0 flex-1 truncate ${r.available ? "text-surface-700" : "text-surface-400"}`}>{r.label}</span>
              <span className={`shrink-0 text-xs ${r.available ? "text-surface-500" : "text-surface-300"}`}>{r.available ? r.detail : "Coming soon"}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
