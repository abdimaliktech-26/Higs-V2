import { Sparkles, Calendar, Inbox, ListChecks } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function AiExecutiveAssistant() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          AI Executive Assistant
          <Badge variant="info" size="sm">BETA</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EmptyState
          className="py-8"
          icon={<Sparkles className="h-6 w-6" />}
          title="AI insights not yet available"
          description="Executive snapshot, biggest improvement, biggest risk, and recommended next step will appear here once AI reporting is connected."
        />
        <div className="space-y-2 border-t border-surface-100 pt-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Generate with AI</p>
          <Button variant="primary" size="sm" fullWidth disabled title={NOT_WIRED}>Generate Executive Summary</Button>
          <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Generate DHS Report</Button>
          <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Generate Board Packet</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function RecentReportsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Recent Reports</CardTitle></CardHeader>
      <CardContent>
        <EmptyState
          className="py-8"
          icon={<Inbox className="h-6 w-6" />}
          title="No reports generated yet"
          description="Generated reports will be listed here with their status, format, and owner."
        />
      </CardContent>
    </Card>
  )
}

export function ReportingPipelineCard() {
  const stages = ["Draft", "Generating", "Completed", "Shared"]
  return (
    <Card>
      <CardHeader><CardTitle>Reporting Pipeline</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-4 gap-2 text-center">
          {stages.map((s) => (
            <div key={s} className="rounded-lg border border-surface-100 p-3">
              <p className="text-lg font-bold text-surface-300">—</p>
              <p className="mt-1 text-[11px] text-surface-500">{s}</p>
            </div>
          ))}
        </div>
        <p className="mt-3 flex items-center gap-1.5 text-xs text-surface-400">
          <ListChecks className="h-3.5 w-3.5" /> Pipeline stage counts require a reports queue, not yet implemented.
        </p>
      </CardContent>
    </Card>
  )
}

export function ScheduledReportsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Scheduled Reports</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-col items-center py-6 text-center">
          <Calendar className="mb-2 h-8 w-8 text-surface-300" />
          <p className="text-sm font-medium text-surface-600">No scheduled reports yet</p>
          <p className="mt-1 text-xs text-surface-400">Schedule recurring reports for automatic delivery to your team.</p>
        </div>
      </CardContent>
    </Card>
  )
}
