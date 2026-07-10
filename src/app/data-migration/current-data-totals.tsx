import { Users, FolderOpen, FileText, CheckCircle2 } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

interface Props {
  clientsTotal: number
  packetsTotal: number
  documentsTotal: number
  passRatePct: number | null
}

export function CurrentDataTotalsRow({ clientsTotal, packetsTotal, documentsTotal, passRatePct }: Props) {
  return (
    <div>
      <h2 className="mb-3 text-base font-semibold text-surface-900">Current Organization Data</h2>
      <p className="mb-4 text-xs text-surface-400">Current totals in this organization — not migration/import counts.</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-surface-500"><Users className="h-4 w-4" /><p className="text-xs font-medium">Clients</p></div>
            <p className="mt-2 text-3xl font-bold text-surface-900">{clientsTotal}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-surface-500"><FolderOpen className="h-4 w-4" /><p className="text-xs font-medium">Packets</p></div>
            <p className="mt-2 text-3xl font-bold text-surface-900">{packetsTotal}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-surface-500"><FileText className="h-4 w-4" /><p className="text-xs font-medium">Documents</p></div>
            <p className="mt-2 text-3xl font-bold text-surface-900">{documentsTotal}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <div className="flex items-center gap-2 text-surface-500"><CheckCircle2 className="h-4 w-4" /><p className="text-xs font-medium">Validation Pass Rate</p></div>
            <p className="mt-2 text-3xl font-bold text-surface-900">{passRatePct !== null ? `${passRatePct}%` : "—"}</p>
            <p className="mt-1 text-xs text-surface-400">Validations with zero critical issues</p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
