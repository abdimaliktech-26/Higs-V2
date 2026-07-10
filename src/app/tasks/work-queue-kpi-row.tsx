import { Briefcase, ListTodo, AlertTriangle, CalendarClock, PenSquare, ShieldAlert, CheckCircle2, TrendingUp, Timer } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { WorkQueueKpis } from "./work-queue-metrics"

export function WorkQueueKpiRow({ kpis }: { kpis: WorkQueueKpis }) {
  const cards = [
    { icon: Briefcase, label: "My Workload Today", value: kpis.myWorkloadToday, color: "#3b82f6" },
    { icon: ListTodo, label: "My Open Tasks", value: kpis.myOpenTasks, color: "#0ea5e9" },
    { icon: AlertTriangle, label: "Overdue Tasks", value: kpis.overdueTasks, color: "#ef4444" },
    { icon: CalendarClock, label: "Due Today", value: kpis.dueToday, color: "#f59e0b" },
    { icon: PenSquare, label: "Waiting for Signature", value: kpis.waitingForSignature, color: "#8b5cf6" },
    { icon: ShieldAlert, label: "Validation Issues", value: kpis.validationIssues, color: "#ef4444" },
    { icon: CheckCircle2, label: "Completed Today", value: kpis.completedToday, color: "#10b981" },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[repeat(7,minmax(0,1fr))_minmax(0,1.6fr)]">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:col-span-7 lg:grid-cols-7">
        {cards.map((c) => (
          <Card key={c.label}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-surface-500">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-100">
                  <c.icon className="h-3.5 w-3.5" style={{ color: c.color }} />
                </div>
                <p className="text-xs font-medium">{c.label}</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-surface-900">{c.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardContent className="flex h-full flex-col justify-center gap-4 p-4">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-success-500" />
            <div>
              <p className="text-xs text-surface-500">Team Completion Rate</p>
              <p className="text-lg font-bold text-surface-900">{kpis.teamCompletionRatePct !== null ? `${kpis.teamCompletionRatePct}%` : "—"}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-brand-500" />
            <div>
              <p className="text-xs text-surface-500">Average Resolution Time</p>
              <p className="text-lg font-bold text-surface-900">{kpis.avgResolutionHours !== null ? `${kpis.avgResolutionHours}h` : "—"}</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
