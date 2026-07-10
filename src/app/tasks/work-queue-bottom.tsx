import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import { RadialGauge } from "@/components/ui/charts"
import { ListPlus, ShieldCheck, PenSquare, CheckSquare, SearchCheck } from "lucide-react"
import { readinessLabel, formatDate } from "@/lib/utils"
import type { WorkQueueKpis, WorkloadByAssignee } from "./work-queue-metrics"
import type { UpcomingDeadline } from "@/app/notifications/notifications-data"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function ComplianceWorkOverviewCard({ score, kpis }: { score: number | null; kpis: WorkQueueKpis }) {
  return (
    <Card>
      <CardHeader><CardTitle>Compliance Work Overview</CardTitle></CardHeader>
      <CardContent>
        <div className="flex items-center gap-4">
          <RadialGauge value={score ?? 0} size={96} progressClassName="stroke-success-500" trackClassName="stroke-surface-100">
            <span className="text-lg font-bold text-surface-900">{score !== null ? `${score}%` : "—"}</span>
          </RadialGauge>
          <div>
            <Badge variant={score !== null ? "success" : "secondary"} size="sm">{score !== null ? readinessLabel(score) : "Not available"}</Badge>
            <p className="mt-2 text-xs text-surface-500">{kpis.overdueTasks} overdue · {kpis.validationIssues} validation issue{kpis.validationIssues !== 1 ? "s" : ""}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function CalendarTimelineCard({ deadlines }: { deadlines: UpcomingDeadline[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Calendar &amp; Timeline</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-surface-400">A full calendar view isn&apos;t available yet — showing real upcoming due dates.</p>
        {deadlines.length === 0 ? (
          <p className="text-xs text-surface-400">Nothing due in the next 7 days.</p>
        ) : (
          <ul className="space-y-2">
            {deadlines.slice(0, 5).map((d) => (
              <li key={d.packetId} className="flex items-center justify-between text-sm">
                <span className="truncate text-surface-700">{d.clientName}</span>
                <span className="shrink-0 text-xs text-surface-400">{formatDate(d.dueDate)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function TeamWorkloadHeatmapCard({ workload }: { workload: WorkloadByAssignee[] }) {
  const max = Math.max(...workload.map((w) => w.count), 1)
  return (
    <Card>
      <CardHeader><CardTitle>Team Workload Heatmap</CardTitle></CardHeader>
      <CardContent>
        {workload.length === 0 ? (
          <EmptyState className="py-6" title="No assigned work items" description="Workload distribution will appear once packets are assigned to staff." />
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {workload.map((w) => {
              const intensity = w.count / max
              const bg = intensity > 0.66 ? "bg-danger-100 text-danger-700" : intensity > 0.33 ? "bg-warning-100 text-warning-700" : "bg-success-100 text-success-700"
              return (
                <div key={w.name} className={`rounded-lg p-3 text-center ${bg}`}>
                  <p className="truncate text-xs font-medium">{w.name}</p>
                  <p className="text-lg font-bold">{w.count}</p>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function WorkloadAnalyticsCard({ workload }: { workload: WorkloadByAssignee[] }) {
  const max = Math.max(...workload.map((w) => w.count), 1)
  return (
    <Card>
      <CardHeader><CardTitle>Workload Analytics</CardTitle></CardHeader>
      <CardContent>
        {workload.length === 0 ? (
          <p className="text-xs text-surface-400">No assigned work items yet.</p>
        ) : (
          <div className="space-y-2.5">
            {workload.slice(0, 6).map((w) => (
              <div key={w.name}>
                <div className="mb-1 flex justify-between text-xs text-surface-600"><span>{w.name}</span><span>{w.count}</span></div>
                <Progress value={Math.round((w.count / max) * 100)} size="sm" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

interface QuickAction { label: string; icon: typeof ShieldCheck; href?: string }

const quickActions: QuickAction[] = [
  { label: "Create Task", icon: ListPlus },
  { label: "Open Validation Center", icon: ShieldCheck, href: "/validation" },
  { label: "Open Signature Workflow", icon: PenSquare, href: "/signatures" },
  { label: "Open Approval Center", icon: CheckSquare, href: "/approvals" },
  { label: "Open Audit Center", icon: SearchCheck, href: "/audit" },
]

export function WorkQueueQuickActionsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map((a) => (
            a.href ? (
              <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center hover:bg-surface-50">
                <a.icon className="h-4 w-4 text-surface-500" />
                <span className="text-xs font-medium text-surface-700">{a.label}</span>
              </Link>
            ) : (
              <button key={a.label} disabled title={NOT_WIRED} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center opacity-50 cursor-not-allowed">
                <a.icon className="h-4 w-4 text-surface-400" />
                <span className="text-xs font-medium text-surface-500">{a.label}</span>
              </button>
            )
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
