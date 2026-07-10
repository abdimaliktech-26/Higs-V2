import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { RadialGauge } from "@/components/ui/charts"

interface Props {
  completedDocs: number
  inProgressDocs: number
  notStartedDocs: number
  totalDocs: number
  progressPct: number
}

export function PacketProgressRadial({ completedDocs, inProgressDocs, notStartedDocs, totalDocs, progressPct }: Props) {
  return (
    <Card>
      <CardHeader><CardTitle>Packet Progress</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center gap-6 sm:flex-row">
        <RadialGauge value={progressPct} size={140} progressClassName="stroke-success-500" trackClassName="stroke-surface-100">
          <span className="text-2xl font-bold text-surface-900">{progressPct}%</span>
          <span className="text-[11px] text-surface-400">Complete</span>
        </RadialGauge>
        <div className="grid flex-1 grid-cols-3 gap-2 text-center text-sm">
          <div className="rounded-lg bg-success-50 py-3">
            <p className="text-lg font-bold text-success-700">{completedDocs}</p>
            <p className="text-xs text-success-600">Completed</p>
          </div>
          <div className="rounded-lg bg-brand-50 py-3">
            <p className="text-lg font-bold text-brand-700">{inProgressDocs}</p>
            <p className="text-xs text-brand-600">In Progress</p>
          </div>
          <div className="rounded-lg bg-surface-100 py-3">
            <p className="text-lg font-bold text-surface-600">{notStartedDocs}</p>
            <p className="text-xs text-surface-500">Not Started</p>
          </div>
        </div>
        <p className="sm:hidden text-xs text-surface-400">{totalDocs} total documents</p>
      </CardContent>
    </Card>
  )
}
