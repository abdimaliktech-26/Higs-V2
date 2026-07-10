import Link from "next/link"
import { Sparkles, Lightbulb, BookOpen, FileSearch, Users, ShieldCheck, Copy, FileBarChart, MessageSquareText, type LucideIcon } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { RadialGauge } from "@/components/ui/charts"
import { readinessLabel, truncate } from "@/lib/utils"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface AiRecommendation { id: string; message: string; type: string }

export function HigsiAiInsightsCard({ recommendations }: { recommendations: AiRecommendation[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">Higsi AI Insights <Badge variant="info" size="sm">BETA</Badge></CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EmptyState className="py-6" icon={<Sparkles className="h-6 w-6" />} title="Insights not yet available" description="AI-generated daily insights will appear here once connected." />

        <div className="border-t border-surface-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Top Recommendations</p>
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
        </div>
      </CardContent>
    </Card>
  )
}

export function AuditReadinessSnapshotCard({ score, packetsTotal, evidenceReadyPackets }: { score: number | null; packetsTotal: number; evidenceReadyPackets: number }) {
  return (
    <Card>
      <CardHeader><CardTitle>Audit Readiness Snapshot</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-2">
          <RadialGauge value={score ?? 0} size={120} progressClassName="stroke-success-500" trackClassName="stroke-surface-100">
            <span className="text-2xl font-bold text-surface-900">{score !== null ? `${score}%` : "—"}</span>
          </RadialGauge>
          <Badge variant={score !== null ? "success" : "secondary"} size="sm">{score !== null ? readinessLabel(score) : "Not available"}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-xs text-surface-500">Total Packets</p><p className="font-semibold text-surface-900">{packetsTotal}</p></div>
          <div><p className="text-xs text-surface-500">Evidence Ready</p><p className="font-semibold text-surface-900">{evidenceReadyPackets}</p></div>
        </div>
        <Link href="/audit"><Button variant="secondary" size="sm" fullWidth className="mt-4">View Audit Center</Button></Link>
      </CardContent>
    </Card>
  )
}

interface QuickAction { label: string; icon: LucideIcon; href?: string }

const quickActions: QuickAction[] = [
  { label: "Analyze Packet", icon: FileSearch, href: "/packets" },
  { label: "Analyze Client", icon: Users, href: "/clients" },
  { label: "Run Validation", icon: ShieldCheck, href: "/validation" },
  { label: "Audit Readiness", icon: ShieldCheck, href: "/audit" },
  { label: "Compare Docs", icon: Copy },
  { label: "Generate Report", icon: FileBarChart, href: "/reports" },
  { label: "Ask Higsi AI", icon: MessageSquareText },
]

export function AiCopilotQuickActionsCard() {
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

export function KnowledgeBaseCard() {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><BookOpen className="h-4 w-4 text-surface-400" /> Knowledge Base</CardTitle></CardHeader>
      <CardContent>
        <EmptyState className="py-6" icon={<BookOpen className="h-6 w-6" />} title="Knowledge base search coming soon" description="Searching MN 245D rules, DHS guidance, and policies isn't available yet." />
      </CardContent>
    </Card>
  )
}
