import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import {
  ShieldCheck, AlertTriangle, Activity, Eye, Lock, Download, Scale, PenSquare, CheckSquare,
} from "lucide-react"
import { auditCategories, HIGH_RISK_ACTIONS, targetHref } from "./audit-categories"
import { formatDateTime } from "@/lib/utils"

interface RecentEvent { action: string; createdAt: Date }
interface PhiEvent { id: string; action: string; createdAt: Date; targetType: string | null; targetId: string | null; actor: { name: string | null; email: string } | null }

interface Props {
  auditReadinessScore: number | null
  totalEvents: number
  eventsLast30Days: number
  recentEvents: RecentEvent[]
  recentPhiEvents: PhiEvent[]
  packetsTotal: number
  evidenceReadyPackets: number
}

const PHI_ACTION_LABEL: Record<string, string> = {
  CLIENT_VIEWED: "Viewed client record",
  DOCUMENT_VIEWED: "Viewed document",
  PACKET_VIEWED: "Viewed packet",
}

export function AuditDashboard({ auditReadinessScore, totalEvents, eventsLast30Days, recentEvents, recentPhiEvents, packetsTotal, evidenceReadyPackets }: Props) {
  const highRiskCount = recentEvents.filter((e) => HIGH_RISK_ACTIONS.includes(e.action)).length

  const categoryCounts = Object.entries(auditCategories).map(([key, cat]) => ({
    key, label: cat.label,
    count: recentEvents.filter((e) => cat.actions.includes(e.action)).length,
  }))

  const evidenceReadyPct = packetsTotal > 0 ? Math.round((evidenceReadyPackets / packetsTotal) * 100) : 0

  return (
    <div className="space-y-6">
      {/* Readiness + top-line stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><ShieldCheck className="h-4 w-4" /><span className="text-xs font-medium">Audit Readiness</span></div>
            <p className="mt-2 text-2xl font-bold text-surface-900">{auditReadinessScore === null ? "—" : `${auditReadinessScore}%`}</p>
            <p className="mt-1 text-xs text-surface-400">Required documents completed org-wide</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><Activity className="h-4 w-4" /><span className="text-xs font-medium">Total Audit Events</span></div>
            <p className="mt-2 text-2xl font-bold text-surface-900">{totalEvents}</p>
            <p className="mt-1 text-xs text-surface-400">{eventsLast30Days} in the last 30 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><AlertTriangle className="h-4 w-4" /><span className="text-xs font-medium">High-Risk Events</span></div>
            <p className={`mt-2 text-2xl font-bold ${highRiskCount > 0 ? "text-danger-600" : "text-surface-900"}`}>{highRiskCount}</p>
            <p className="mt-1 text-xs text-surface-400">Denials, rejections, declines · last 30 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><Lock className="h-4 w-4" /><span className="text-xs font-medium">Evidence-Ready Packets</span></div>
            <p className="mt-2 text-2xl font-bold text-surface-900">{evidenceReadyPackets}<span className="text-sm font-normal text-surface-400">/{packetsTotal}</span></p>
            <Progress value={evidenceReadyPct} size="sm" className="mt-2" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Activity summary by category */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-surface-400" />
              <CardTitle>Activity Summary</CardTitle>
              <CardDescription>By category, last 30 days</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {categoryCounts.map((c) => (
                <Link
                  key={c.key}
                  href={`/audit?action=${auditCategories[c.key].actions[0]}`}
                  className="rounded-lg border border-surface-100 p-3 text-center hover:bg-surface-50 transition-colors"
                >
                  <p className="text-lg font-bold text-surface-900">{c.count}</p>
                  <p className="text-xs text-surface-500">{c.label}</p>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Locked / approved packet evidence status */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-surface-400" />
              <CardTitle>Evidence Status</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-surface-500">Approved / archived packets</span>
                <span className="font-medium text-surface-900">{evidenceReadyPackets} of {packetsTotal}</span>
              </div>
              <Progress value={evidenceReadyPct} size="sm" className="mt-1.5" variant={evidenceReadyPct >= 80 ? "success" : evidenceReadyPct >= 50 ? "warning" : "danger"} />
            </div>
            <p className="text-xs text-surface-400">
              Approved and archived packets are considered locked and audit-evidence-ready. Everything else is still in an active workflow state.
            </p>
            <Button className="w-full justify-start" variant="secondary" disabled>
              <Download className="h-4 w-4" /> Generate Evidence Packet
              <span className="ml-auto text-[10px] text-surface-400">Coming soon</span>
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Recent PHI / document access */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-surface-400" />
            <CardTitle>Recent PHI &amp; Document Access</CardTitle>
            <CardDescription>Who viewed client records, packets, and documents</CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          {recentPhiEvents.length === 0 ? (
            <EmptyState title="No access events yet" icon={<Eye className="h-6 w-6" />} />
          ) : (
            <div className="space-y-1">
              {recentPhiEvents.map((e) => {
                const href = targetHref(e.targetType, e.targetId)
                const row = (
                  <div className="flex items-center gap-3 rounded-lg border border-surface-100 p-3">
                    <Badge variant="secondary" size="sm">{PHI_ACTION_LABEL[e.action] || e.action.replace(/_/g, " ")}</Badge>
                    <span className="flex-1 min-w-0 truncate text-sm text-surface-700">{e.actor?.name || e.actor?.email || "System"}</span>
                    <span className="shrink-0 text-xs text-surface-400">{formatDateTime(e.createdAt)}</span>
                  </div>
                )
                return href ? <Link key={e.id} href={href} className="block hover:bg-surface-50 rounded-lg transition-colors">{row}</Link> : <div key={e.id}>{row}</div>
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Validation / signature / approval activity quick links */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Link href="/audit?action=VALIDATION_RUN">
          <Card className="hover:bg-surface-50 transition-colors">
            <CardContent className="flex items-center gap-3 p-4">
              <Scale className="h-5 w-5 text-brand-500" />
              <div>
                <p className="text-sm font-medium text-surface-900">{categoryCounts.find((c) => c.key === "validation")?.count ?? 0} validation events</p>
                <p className="text-xs text-surface-400">Last 30 days</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/audit?action=SIGNATURE_COMPLETED">
          <Card className="hover:bg-surface-50 transition-colors">
            <CardContent className="flex items-center gap-3 p-4">
              <PenSquare className="h-5 w-5 text-brand-500" />
              <div>
                <p className="text-sm font-medium text-surface-900">{categoryCounts.find((c) => c.key === "signatures")?.count ?? 0} signature events</p>
                <p className="text-xs text-surface-400">Last 30 days</p>
              </div>
            </CardContent>
          </Card>
        </Link>
        <Link href="/audit?action=APPROVAL_SUBMITTED">
          <Card className="hover:bg-surface-50 transition-colors">
            <CardContent className="flex items-center gap-3 p-4">
              <CheckSquare className="h-5 w-5 text-brand-500" />
              <div>
                <p className="text-sm font-medium text-surface-900">{categoryCounts.find((c) => c.key === "approvals")?.count ?? 0} approval events</p>
                <p className="text-xs text-surface-400">Last 30 days</p>
              </div>
            </CardContent>
          </Card>
        </Link>
      </div>
    </div>
  )
}
