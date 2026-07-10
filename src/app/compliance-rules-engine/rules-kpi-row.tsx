import { Scale, CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { readinessLabel } from "@/lib/utils"
import type { RulesKpis } from "./rules-metrics"

export function RulesKpiRow({ kpis, auditReadinessScore }: { kpis: RulesKpis; auditReadinessScore: number | null }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><Scale className="h-4 w-4" /><p className="text-xs font-medium">Active Rules</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{kpis.activeRulesCount}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><CheckCircle2 className="h-4 w-4" /><p className="text-xs font-medium">Compliance Pass Rate</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{kpis.passRatePct !== null ? `${kpis.passRatePct}%` : "—"}</p>
          <p className="mt-1 text-xs text-surface-400">Validations with zero critical issues</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><AlertTriangle className="h-4 w-4" /><p className="text-xs font-medium">Failed Validations Today</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{kpis.failedValidationsToday}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><ShieldCheck className="h-4 w-4" /><p className="text-xs font-medium">Audit Readiness Score</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{auditReadinessScore !== null ? `${auditReadinessScore}%` : "—"}</p>
          <p className="mt-1 text-xs text-surface-400">{auditReadinessScore !== null ? readinessLabel(auditReadinessScore) : "Not available"}</p>
        </CardContent>
      </Card>
    </div>
  )
}
