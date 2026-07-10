import { ShieldCheck, CheckCircle2, Users, AlertTriangle } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { readinessLabel } from "@/lib/utils"

interface Props {
  auditReadinessScore: number | null
  passRatePct: number | null
  clientsServed: number
}

export function ExecutiveKpiRow({ auditReadinessScore, passRatePct, clientsServed }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><ShieldCheck className="h-4 w-4" /><p className="text-xs font-medium">Audit Readiness Score</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{auditReadinessScore !== null ? `${auditReadinessScore}%` : "—"}</p>
          <p className="mt-1 text-xs text-surface-400">{auditReadinessScore !== null ? readinessLabel(auditReadinessScore) : "Not available"}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><CheckCircle2 className="h-4 w-4" /><p className="text-xs font-medium">Compliance Pass Rate</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{passRatePct !== null ? `${passRatePct}%` : "—"}</p>
          <p className="mt-1 text-xs text-surface-400">Validations with zero critical issues</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><Users className="h-4 w-4" /><p className="text-xs font-medium">Clients Served</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{clientsServed}</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><AlertTriangle className="h-4 w-4" /><p className="text-xs font-medium">High Risk Clients</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-300">—</p>
          <p className="mt-1 text-xs text-surface-400">Not tracked yet</p>
        </CardContent>
      </Card>
    </div>
  )
}
