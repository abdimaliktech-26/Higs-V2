import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { RadialGauge } from "@/components/ui/charts"
import type { Readiness } from "./packet-overview-metrics"

const toneStroke: Record<Readiness["tone"], string> = {
  success: "stroke-success-500",
  warning: "stroke-warning-500",
  danger: "stroke-danger-500",
}

export function PacketReadinessCard({ readiness }: { readiness: Readiness }) {
  const { pct, tone, breakdown } = readiness
  return (
    <Card>
      <CardHeader><CardTitle>Packet Readiness</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center gap-4">
        <RadialGauge value={pct} size={110} strokeWidth={10} progressClassName={toneStroke[tone]} trackClassName="stroke-surface-100">
          <span className="text-xl font-bold text-surface-900">{pct}%</span>
        </RadialGauge>
        <p className="text-center text-[11px] text-surface-400">Presentational rollup of validation, signatures, documents, and approval — not an official compliance score.</p>
        <div className="grid w-full grid-cols-2 gap-2 text-center text-sm">
          <Metric label="Pending Signatures" value={breakdown.pendingSignatures} />
          <Metric label="Validation Errors" value={breakdown.validationErrors} />
          <Metric label="Incomplete Documents" value={breakdown.incompleteDocuments} />
          <Metric label="Pending Approval" value={breakdown.pendingApproval} />
        </div>
      </CardContent>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-surface-100 p-2">
      <p className={`text-lg font-bold ${value > 0 ? "text-surface-900" : "text-surface-300"}`}>{value}</p>
      <p className="text-[10px] text-surface-500">{label}</p>
    </div>
  )
}
