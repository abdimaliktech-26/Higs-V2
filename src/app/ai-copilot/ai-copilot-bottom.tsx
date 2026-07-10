import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { RadialGauge } from "@/components/ui/charts"
import { Grid3x3, Users2 } from "lucide-react"
import { readinessLabel, formatDate } from "@/lib/utils"
import type { UpcomingDeadline } from "@/app/notifications/notifications-data"

export function AuditReadinessOverviewCard({ score }: { score: number | null }) {
  return (
    <Card>
      <CardHeader><CardTitle>Audit Readiness Overview</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center">
        <RadialGauge value={score ?? 0} size={120} progressClassName="stroke-success-500" trackClassName="stroke-surface-100">
          <span className="text-2xl font-bold text-surface-900">{score !== null ? `${score}%` : "—"}</span>
        </RadialGauge>
        <Badge variant={score !== null ? "success" : "secondary"} size="sm" className="mt-2">{score !== null ? readinessLabel(score) : "Not available"}</Badge>
        <p className="mt-2 text-xs text-surface-400">Per-department breakdown isn&apos;t tracked yet.</p>
      </CardContent>
    </Card>
  )
}

export function ComplianceRiskHeatmapCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Compliance Risk Heatmap</CardTitle></CardHeader>
      <CardContent>
        <EmptyState className="py-8" icon={<Grid3x3 className="h-6 w-6" />} title="Risk heatmap coming soon" description="Per-program, per-packet-type risk scoring isn't tracked yet." />
      </CardContent>
    </Card>
  )
}

export function UpcomingDeadlinesCard({ deadlines }: { deadlines: UpcomingDeadline[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Upcoming Deadlines</CardTitle>
        <Link href="/packets" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>
      </CardHeader>
      <CardContent>
        {deadlines.length === 0 ? (
          <p className="text-xs text-surface-400">Nothing due in the next 7 days.</p>
        ) : (
          <ul className="space-y-2.5">
            {deadlines.map((d) => (
              <li key={d.packetId} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-surface-900">{d.clientName}</p>
                  <p className="truncate text-xs text-surface-400 capitalize">{d.packetType.replace(/_/g, " ")}</p>
                </div>
                <Link href={`/packets/${d.packetId}`} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">{formatDate(d.dueDate)}</Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function WorkloadOverviewCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Workload Overview</CardTitle></CardHeader>
      <CardContent>
        <EmptyState className="py-8" icon={<Users2 className="h-6 w-6" />} title="Workload tracking coming soon" description="Staff capacity and workload distribution aren't tracked yet." />
      </CardContent>
    </Card>
  )
}
