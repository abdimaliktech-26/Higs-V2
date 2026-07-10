import { Sparkles, ShieldAlert, ScanSearch, ShieldCheck, FileSearch, Gauge, Clock, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkline } from "@/components/ui/charts"
import type { AiCopilotKpi } from "./ai-copilot-metrics"

const icons: Record<string, LucideIcon> = {
  analyses_today: Sparkles,
  compliance_risks: ShieldAlert,
  validation_issues: ScanSearch,
  audit_readiness: ShieldCheck,
  documents_reviewed: FileSearch,
  ai_confidence: Gauge,
  time_saved: Clock,
}

const strokes: Record<string, string> = {
  analyses_today: "#3b82f6",
  compliance_risks: "#ef4444",
  validation_issues: "#8b5cf6",
  audit_readiness: "#f59e0b",
  documents_reviewed: "#0ea5e9",
  ai_confidence: "#10b981",
  time_saved: "#94a3b8",
}

export function AiCopilotKpiRow({ kpis }: { kpis: AiCopilotKpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {kpis.map((k) => {
        const Icon = icons[k.key] || Sparkles
        const stroke = strokes[k.key] || "#3b82f6"
        return (
          <Card key={k.key}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-surface-500">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-100">
                  <Icon className="h-3.5 w-3.5" style={{ color: stroke }} />
                </div>
                <p className="text-xs font-medium">{k.label}</p>
              </div>
              <p className={`mt-2 text-2xl font-bold ${k.available ? "text-surface-900" : "text-surface-300"}`}>{k.value}</p>
              {k.trend ? (
                <Sparkline points={k.trend} height={40} stroke={stroke} fill="transparent" className="mt-2" />
              ) : (
                <p className="mt-2 text-[11px] text-surface-400">{k.available ? "No trend history yet" : "Not tracked yet"}</p>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
