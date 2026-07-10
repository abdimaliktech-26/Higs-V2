import Link from "next/link"
import { Sparkles, Lightbulb } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { EmptyState } from "@/components/ui/states"
import { truncate } from "@/lib/utils"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface AiRecommendation { id: string; message: string; type: string }

export function AiOrganizationAssistant({ recommendations }: { recommendations: AiRecommendation[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          AI Organization Assistant
          <Badge variant="info" size="sm">BETA</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EmptyState
          className="py-6"
          icon={<Sparkles className="h-6 w-6" />}
          title="AI summary not yet available"
          description="Today's Organization Summary will appear here once AI reporting is connected."
        />

        <div className="border-t border-surface-100 pt-4">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Ask Higsi AI</p>
          <div className="flex gap-2">
            <Input placeholder="Ask a question about your organization…" disabled title={NOT_WIRED} className="flex-1" />
            <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Ask</Button>
          </div>
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
          <Link href="/ai-copilot">
            <Button variant="primary" size="sm" fullWidth className="mt-3">Review Recommendations</Button>
          </Link>
        </div>

        <div className="space-y-2 border-t border-surface-100 pt-4">
          <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Optimize Organization</Button>
          <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Generate Configuration Report</Button>
          <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Simulate Configuration Changes</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ExecutiveInsightsCard() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Executive Insights</CardTitle>
        <Link href="/reports" className="text-xs font-medium text-brand-600 hover:underline">View dashboard</Link>
      </CardHeader>
      <CardContent>
        <EmptyState
          className="py-6"
          title="Insight trends not yet available"
          description="Configuration stability, security trend, and adoption trends will appear here. The Reports dashboard has current compliance analytics today."
        />
      </CardContent>
    </Card>
  )
}
