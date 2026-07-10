import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { ShieldCheck, PenSquare, CheckSquare, Clock, ArrowRight, AlertTriangle, XCircle, Info, Check, Lock } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"
import { PacketLockBadge } from "./packet-client-summary"

// ── Validation Summary ──

export interface ValidationSummaryData {
  id: string
  score: number
  criticalCount: number
  warningCount: number
  infoCount: number
  ranAt: Date
  issues: { id: string; severity: string; message: string; fieldName: string | null }[]
}

export function ValidationSummaryPanel({ data, packetId }: { data: ValidationSummaryData | null; packetId: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-surface-400" />
          <CardTitle>Validation Summary</CardTitle>
        </div>
        {data && (
          <Link href={`/validation/${data.id}`}>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              View full report <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {!data ? (
          <EmptyState title="Not validated yet" description="Run validation to check this packet against 245D rules" icon={<ShieldCheck className="h-6 w-6" />} />
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-4">
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full border-4 border-brand-100 text-lg font-bold text-surface-900">
                {data.score}%
              </div>
              <div className="grid flex-1 grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-lg font-bold text-danger-600">{data.criticalCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-surface-400">Critical</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-warning-600">{data.warningCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-surface-400">Warnings</p>
                </div>
                <div>
                  <p className="text-lg font-bold text-surface-500">{data.infoCount}</p>
                  <p className="text-[10px] uppercase tracking-wide text-surface-400">Info</p>
                </div>
              </div>
            </div>
            {data.issues.length > 0 && (
              <div className="space-y-1.5 border-t border-surface-100 pt-3">
                {data.issues.slice(0, 4).map((issue) => (
                  <div key={issue.id} className="flex items-start gap-2 text-xs">
                    {issue.severity === "critical" ? (
                      <XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-danger-500" />
                    ) : issue.severity === "warning" ? (
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" />
                    ) : (
                      <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-surface-400" />
                    )}
                    <span className="text-surface-600">{issue.message}</span>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-surface-400">Last run {formatDateTime(data.ranAt)}</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Signature Summary ──

export interface SignatureSummaryItem {
  id: string
  signerName: string
  signerRole: string
  status: string
  dueDate: Date | null
  signedAt: Date | null
}

export function SignatureSummaryPanel({ requests, packetId }: { requests: SignatureSummaryItem[]; packetId: string }) {
  const completed = requests.filter((r) => r.status === "signed").length
  const pending = requests.filter((r) => ["pending", "sent", "viewed"].includes(r.status)).length
  const declined = requests.filter((r) => r.status === "declined").length

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <PenSquare className="h-5 w-5 text-surface-400" />
          <CardTitle>Signature Summary</CardTitle>
        </div>
        {requests.length > 0 && (
          <Link href={`/signatures?packetId=${packetId}`}>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              View all <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        )}
      </CardHeader>
      <CardContent>
        {requests.length === 0 ? (
          <EmptyState title="No signatures requested" description="Request a signature once the packet is ready" icon={<PenSquare className="h-6 w-6" />} />
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-4 text-sm">
              <span className="font-medium text-surface-900">{completed} of {requests.length} complete</span>
              {pending > 0 && <span className="text-warning-600">{pending} pending</span>}
              {declined > 0 && <span className="text-danger-600">{declined} declined</span>}
            </div>
            <div className="space-y-1.5">
              {requests.slice(0, 5).map((r) => (
                <Link key={r.id} href={`/signatures/${r.id}`} className="flex items-center justify-between rounded-lg border border-surface-100 px-3 py-2 hover:bg-surface-50 transition-colors">
                  <div className="min-w-0">
                    <p className="text-sm text-surface-900 truncate">{r.signerName}</p>
                    <p className="text-xs text-surface-500 capitalize">{r.signerRole.replace(/_/g, " ")}</p>
                  </div>
                  <Badge
                    variant={r.status === "signed" ? "success" : r.status === "declined" ? "danger" : "warning"}
                    size="sm"
                  >
                    {r.status}
                  </Badge>
                </Link>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Approval Status ──

export interface ApprovalStatusData {
  id: string
  status: string
  submittedByName: string | null
  approverName: string | null
  submittedAt: Date
  decidedAt: Date | null
  decisionNotes: string | null
  pendingSignatureCount: number
  completedSignatureCount: number
}

const APPROVAL_STEPS = [
  { key: "submitted", label: "Submitted" },
  { key: "review", label: "In Review" },
  { key: "decided", label: "Decided" },
]

function ApprovalWorkflowSteps({ data }: { data: ApprovalStatusData }) {
  const stepIndex = data.decidedAt ? 2 : 1
  return (
    <div className="flex items-center gap-1">
      {APPROVAL_STEPS.map((step, i) => (
        <div key={step.key} className="flex flex-1 items-center gap-1">
          <div className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${i <= stepIndex ? (data.status === "rejected" && i === 2 ? "bg-danger-500 text-white" : "bg-brand-600 text-white") : "bg-surface-100 text-surface-400"}`}>
            {i < stepIndex || (i === stepIndex && data.decidedAt) ? <Check className="h-3.5 w-3.5" /> : i + 1}
          </div>
          {i < APPROVAL_STEPS.length - 1 && <div className={`h-0.5 flex-1 ${i < stepIndex ? "bg-brand-600" : "bg-surface-100"}`} />}
        </div>
      ))}
    </div>
  )
}

export function ApprovalStatusPanel({ data, packetId, packetStatus }: { data: ApprovalStatusData | null; packetId: string; packetStatus: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-5 w-5 text-surface-400" />
          <CardTitle>Approval Status</CardTitle>
        </div>
        {data && (
          <Link href={`/approvals/${data.id}`}>
            <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
              View details <ArrowRight className="h-3 w-3" />
            </span>
          </Link>
        )}
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center justify-between rounded-lg bg-surface-50 p-2.5">
          <span className="flex items-center gap-1.5 text-xs font-medium text-surface-500"><Lock className="h-3.5 w-3.5" /> Packet Lock</span>
          <PacketLockBadge status={packetStatus} />
        </div>
        {!data ? (
          <EmptyState title="Not submitted for approval" description="Submit this packet once validation and signatures are complete" icon={<CheckSquare className="h-6 w-6" />} />
        ) : (
          <div className="space-y-4 text-sm">
            <ApprovalWorkflowSteps data={data} />
            <div className="flex items-center justify-between">
              <span className="text-surface-500">Status</span>
              <Badge
                variant={data.status === "approved" ? "success" : data.status === "rejected" ? "danger" : "warning"}
              >
                {data.status.replace(/_/g, " ")}
              </Badge>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-surface-500">Submitted by</span>
              <span className="text-surface-700">{data.submittedByName || "Unknown"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-surface-500">Approver</span>
              <span className="text-surface-700">{data.approverName || "Unassigned"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-surface-500">Signatures</span>
              <span className="text-surface-700">{data.completedSignatureCount} of {data.completedSignatureCount + data.pendingSignatureCount}</span>
            </div>
            {data.decidedAt && (
              <div className="flex items-center justify-between">
                <span className="text-surface-500">Decided</span>
                <span className="text-surface-700">{formatDate(data.decidedAt)}</span>
              </div>
            )}
            {data.decisionNotes && (
              <p className="rounded-lg bg-surface-50 p-2 text-xs text-surface-600">{data.decisionNotes}</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

// ── Activity / Audit Preview ──

export interface ActivityItem {
  id: string
  action: string
  actorName: string | null
  createdAt: Date
  targetType: string | null
}

export function ActivityPreviewPanel({ events, packetId }: { events: ActivityItem[]; packetId: string }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-surface-400" />
          <CardTitle>Activity</CardTitle>
          <CardDescription>Audit trail preview</CardDescription>
        </div>
        <Link href={`/audit?targetType=packet&targetId=${packetId}`}>
          <span className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
            View full trail <ArrowRight className="h-3 w-3" />
          </span>
        </Link>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState title="No activity yet" icon={<Clock className="h-6 w-6" />} />
        ) : (
          <div className="space-y-2">
            {events.slice(0, 6).map((e) => (
              <div key={e.id} className="flex items-center gap-3 py-1.5 border-b border-surface-100 last:border-0">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-100 shrink-0">
                  <Clock className="h-3 w-3 text-surface-400" />
                </div>
                <p className="flex-1 min-w-0 truncate text-xs text-surface-600">
                  <span className="font-medium text-surface-800">{e.actorName || "System"}</span>{" "}
                  {e.action.toLowerCase().replace(/_/g, " ")}
                </p>
                <span className="shrink-0 text-[11px] text-surface-400">{formatDate(e.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
