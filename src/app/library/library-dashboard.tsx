import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import {
  FileText, Clock, PenSquare, ScrollText, Lock, FolderOpen, SearchCheck, Activity,
} from "lucide-react"
import { formatDateTime } from "@/lib/utils"

interface StatusRow { status: string; count: number }
interface ActivityEvent { id: string; action: string; createdAt: Date; actor: { name: string | null; email: string } | null }

interface Props {
  totalActive: number
  totalLocked: number
  totalTemplates: number
  totalSupporting: number
  totalDocuments: number
  awaitingSignature: number
  statusBreakdown: StatusRow[]
  recentActivity: ActivityEvent[]
}

const STATUS_LABEL: Record<string, string> = {
  pending: "Not Started", in_progress: "In Progress", needs_review: "Needs Review",
  completed: "Completed", rejected: "Rejected",
}

export function LibraryDashboard({ totalActive, totalLocked, totalTemplates, totalSupporting, totalDocuments, awaitingSignature, statusBreakdown, recentActivity }: Props) {
  const lockedPct = totalDocuments > 0 ? Math.round((totalLocked / totalDocuments) * 100) : 0

  const smartCollections = [
    { label: "Recent Documents", count: totalActive, href: "/library?tab=active", icon: Clock },
    { label: "Awaiting Signature", count: awaitingSignature, href: "/library?tab=active&status=awaiting_signature", icon: PenSquare },
    { label: "Templates", count: totalTemplates, href: "/library?tab=templates", icon: ScrollText },
    { label: "Locked / Archived", count: totalLocked, href: "/library?tab=approved", icon: Lock },
    { label: "Supporting Documents", count: totalSupporting, href: "/library?tab=supporting", icon: FolderOpen },
  ]

  return (
    <div className="space-y-6">
      {/* Document status summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><FileText className="h-4 w-4" /><span className="text-xs font-medium">Total Documents</span></div>
            <p className="mt-2 text-2xl font-bold text-surface-900">{totalDocuments + totalTemplates + totalSupporting}</p>
            <p className="mt-1 text-xs text-surface-400">Packet, template &amp; supporting docs</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><Activity className="h-4 w-4" /><span className="text-xs font-medium">Active Documents</span></div>
            <p className="mt-2 text-2xl font-bold text-surface-900">{totalActive}</p>
            <p className="mt-1 text-xs text-surface-400">In packets still being worked</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><PenSquare className="h-4 w-4" /><span className="text-xs font-medium">Awaiting Signature</span></div>
            <p className={`mt-2 text-2xl font-bold ${awaitingSignature > 0 ? "text-warning-600" : "text-surface-900"}`}>{awaitingSignature}</p>
            <p className="mt-1 text-xs text-surface-400">Documents in signature-routing packets</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500"><Lock className="h-4 w-4" /><span className="text-xs font-medium">Locked / Archived</span></div>
            <p className="mt-2 text-2xl font-bold text-surface-900">{totalLocked}<span className="text-sm font-normal text-surface-400">/{totalDocuments}</span></p>
            <Progress value={lockedPct} size="sm" className="mt-2" />
          </CardContent>
        </Card>
      </div>

      {/* Smart collections */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <SearchCheck className="h-5 w-5 text-surface-400" />
            <CardTitle>Smart Collections</CardTitle>
          </div>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {smartCollections.map((c) => {
              const Icon = c.icon
              return (
                <Link key={c.label} href={c.href} className="rounded-lg border border-surface-100 p-3 text-center hover:bg-surface-50 transition-colors">
                  <Icon className="mx-auto h-4 w-4 text-surface-400" />
                  <p className="mt-1.5 text-lg font-bold text-surface-900">{c.count}</p>
                  <p className="text-xs text-surface-500">{c.label}</p>
                </Link>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Document status breakdown */}
        <Card>
          <CardHeader>
            <CardTitle>Document Status</CardTitle>
            <CardDescription>Across all active packet documents</CardDescription>
          </CardHeader>
          <CardContent>
            {statusBreakdown.length === 0 ? (
              <EmptyState title="No documents yet" icon={<FileText className="h-6 w-6" />} />
            ) : (
              <div className="space-y-2">
                {statusBreakdown.map((row) => (
                  <div key={row.status} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
                    <span className="text-sm text-surface-700">{STATUS_LABEL[row.status] || row.status.replace(/_/g, " ")}</span>
                    <span className="text-sm font-bold text-surface-900">{row.count}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent uploads / activity */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5 text-surface-400" />
              <CardTitle>Recent Activity</CardTitle>
            </div>
            <Link href="/audit?action=DOCUMENT_SAVED" className="text-sm font-medium text-brand-600 hover:text-brand-700">
              View audit trail
            </Link>
          </CardHeader>
          <CardContent>
            {recentActivity.length === 0 ? (
              <EmptyState title="No recent document activity" icon={<Clock className="h-6 w-6" />} />
            ) : (
              <div className="space-y-2">
                {recentActivity.map((e) => (
                  <div key={e.id} className="flex items-center gap-3 py-1.5 border-b border-surface-100 last:border-0">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-100 shrink-0">
                      <FileText className="h-3 w-3 text-surface-400" />
                    </div>
                    <p className="flex-1 min-w-0 truncate text-xs text-surface-600">
                      <span className="font-medium text-surface-800">{e.actor?.name || e.actor?.email || "System"}</span>{" "}
                      {e.action.toLowerCase().replace(/_/g, " ")}
                    </p>
                    <span className="shrink-0 text-[11px] text-surface-400">{formatDateTime(e.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
