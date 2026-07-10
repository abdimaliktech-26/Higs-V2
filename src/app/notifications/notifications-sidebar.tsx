import Link from "next/link"
import { Sparkles, Lightbulb, PenSquare, CheckSquare, ShieldCheck, ListPlus } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { EmptyState } from "@/components/ui/states"
import { truncate } from "@/lib/utils"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface AiRecommendation { id: string; message: string; type: string }
interface OrgMember { id: string; user: { name: string | null; email: string } }

export function HigsiAiAssistantCard({ recommendations }: { recommendations: AiRecommendation[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          Higsi AI Assistant
          <Badge variant="info" size="sm">BETA</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <EmptyState
          className="py-6"
          icon={<Sparkles className="h-6 w-6" />}
          title="Today's summary not yet available"
          description="An AI-generated daily summary will appear here once connected."
        />

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
      </CardContent>
    </Card>
  )
}

export function CommunicationStatusCard({ members }: { members: OrgMember[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Communication Status</CardTitle></CardHeader>
      <CardContent>
        {members.length === 0 ? (
          <p className="text-xs text-surface-400">No staff members found.</p>
        ) : (
          <ul className="space-y-2.5">
            {members.slice(0, 6).map((m) => (
              <li key={m.id} className="flex items-center gap-2.5">
                <Avatar size="sm"><AvatarFallback name={m.user.name} /></Avatar>
                <span className="min-w-0 flex-1 truncate text-sm text-surface-700">{m.user.name || m.user.email}</span>
                <span className="text-xs text-surface-400">Status unknown</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-surface-400">Online presence tracking is not available yet.</p>
      </CardContent>
    </Card>
  )
}

interface QuickAction { label: string; icon: typeof PenSquare; href?: string }

const quickActions: QuickAction[] = [
  { label: "Request Signature", icon: PenSquare, href: "/signatures" },
  { label: "Approve Packet", icon: CheckSquare, href: "/approvals" },
  { label: "Run Validation", icon: ShieldCheck, href: "/validation" },
  { label: "Create Task", icon: ListPlus },
]

export function NotificationsQuickActionsCard() {
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
