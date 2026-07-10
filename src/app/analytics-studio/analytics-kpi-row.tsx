import { Users, CheckCircle2, DollarSign, ShieldAlert } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

interface Props {
  clientsServed: number
  passRatePct: number | null
}

export function AnalyticsKpiRow({ clientsServed, passRatePct }: Props) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><Users className="h-4 w-4" /><p className="text-xs font-medium">Clients Served</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-900">{clientsServed}</p>
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
          <div className="flex items-center gap-2 text-surface-500"><DollarSign className="h-4 w-4" /><p className="text-xs font-medium">Cost per Client</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-300">—</p>
          <p className="mt-1 text-xs text-surface-400">Financial analytics not tracked yet</p>
        </CardContent>
      </Card>
      <Card>
        <CardContent className="p-5">
          <div className="flex items-center gap-2 text-surface-500"><ShieldAlert className="h-4 w-4" /><p className="text-xs font-medium">Incidents Reported</p></div>
          <p className="mt-2 text-3xl font-bold text-surface-300">—</p>
          <p className="mt-1 text-xs text-surface-400">Incident tracking not available yet</p>
        </CardContent>
      </Card>
    </div>
  )
}
