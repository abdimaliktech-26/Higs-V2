import Link from "next/link"
import { Sparkles, Lightbulb, Settings2, Send } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { formatDate, truncate } from "@/lib/utils"
import type { WorkItem } from "./work-queue-data"
import type { UpcomingDeadline } from "@/app/notifications/notifications-data"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface AiRecommendation { id: string; message: string; type: string }

export function AiWorkAssistantCard({ topPriorities, recommendations }: { topPriorities: WorkItem[]; recommendations: AiRecommendation[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">AI Work Assistant <Badge variant="info" size="sm">BETA</Badge></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Today&apos;s Priorities</p>
          {topPriorities.length === 0 ? (
            <p className="text-xs text-surface-400">Nothing high-priority right now.</p>
          ) : (
            <ul className="space-y-1.5">
              {topPriorities.slice(0, 5).map((t) => (
                <li key={t.id} className="text-xs text-surface-600">
                  <Link href={t.href} className="hover:text-brand-700 hover:underline">{t.title}</Link>
                  {t.clientName && <span className="text-surface-400"> · {t.clientName}</span>}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="border-t border-surface-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">AI Recommendations</p>
            {recommendations.length > 0 && <Badge size="sm">{recommendations.length}</Badge>}
          </div>
          {recommendations.length === 0 ? (
            <p className="text-xs text-surface-400">No open recommendations right now.</p>
          ) : (
            <ul className="space-y-2">
              {recommendations.slice(0, 5).map((r) => (
                <li key={r.id} className="flex items-start gap-2 text-xs text-surface-600">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" />
                  {truncate(r.message, 90)}
                </li>
              ))}
            </ul>
          )}
          <Link href="/ai-copilot"><Button variant="primary" size="sm" fullWidth className="mt-3">View All Recommendations</Button></Link>
        </div>

        <div className="border-t border-surface-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Ask Higsi AI</p>
          <div className="flex gap-2">
            <Input placeholder="Ask about your work queue…" disabled title={NOT_WIRED} className="flex-1" />
            <Button variant="ghost" size="icon-sm" disabled title={NOT_WIRED}><Send className="h-4 w-4" /></Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export function UpcomingComplianceDeadlinesCard({ deadlines }: { deadlines: UpcomingDeadline[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Upcoming Compliance Deadlines</CardTitle>
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

export function ConfigurationStatusCard() {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Settings2 className="h-4 w-4 text-surface-400" /> Configuration Status</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center py-4 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Sparkles className="h-6 w-6" /></div>
        <p className="text-sm text-surface-500">Manage organization-level compliance and workflow settings.</p>
        <Link href="/settings/organization" className="mt-4 w-full">
          <Button variant="secondary" size="sm" fullWidth>Open Organization Settings</Button>
        </Link>
      </CardContent>
    </Card>
  )
}
