import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { Donut } from "@/components/ui/charts"
import { Users } from "lucide-react"
import type { ClientsByProgramRow } from "./analytics-data"

const segmentColors = ["stroke-brand-500", "stroke-sky-400", "stroke-violet-400", "stroke-success-500", "stroke-warning-400", "stroke-danger-400"]

export function ClientsByProgramCard({ programs }: { programs: ClientsByProgramRow[] }) {
  const total = programs.reduce((s, p) => s + p.clientCount, 0)

  return (
    <Card>
      <CardHeader><CardTitle>Clients by Program</CardTitle></CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState className="py-8" icon={<Users className="h-6 w-6" />} title="No program enrollments yet" />
        ) : (
          <div className="flex items-center gap-6">
            <Donut
              segments={programs.map((p, i) => ({ label: p.programName, value: p.clientCount, className: segmentColors[i % segmentColors.length] }))}
              size={140}
              strokeWidth={18}
              centerLabel={<><span className="text-xl font-bold text-surface-900">{total}</span><span className="text-[11px] text-surface-400">Total</span></>}
            />
            <ul className="flex-1 space-y-1.5 text-sm">
              {programs.map((p, i) => (
                <li key={p.programId} className="flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${segmentColors[i % segmentColors.length].replace("stroke-", "bg-")}`} />
                    <span className="truncate text-surface-600">{p.programName}</span>
                  </span>
                  <span className="shrink-0 text-xs text-surface-500">{p.clientCount} ({Math.round((p.clientCount / total) * 100)}%)</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
