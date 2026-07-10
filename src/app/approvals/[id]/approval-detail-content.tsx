import { getApprovalDetail, decideApproval, cancelApproval } from "@/lib/actions/approvals"
import { getAuditSummary } from "@/lib/actions/audit"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  ArrowLeft, CheckSquare, PenSquare, FileText, Clock,
  CheckCircle2, XCircle, AlertTriangle, RefreshCw, X, Scale, Hash, ChevronRight, ArrowRight,
} from "lucide-react"
import Link from "next/link"
import { formatDate, formatDateTime } from "@/lib/utils"

interface Props { requestId: string }

function packetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

export async function ApprovalDetailContent({ requestId }: Props) {
  let req: Awaited<ReturnType<typeof getApprovalDetail>>
  try {
    req = await getApprovalDetail(requestId)
  } catch (e) {
    return <ErrorState title="Access Denied" description={(e as Error).message} />
  }
  if (!req) return <EmptyState title="Approval request not found" icon={<CheckSquare className="h-8 w-8" />} />

  const packet = req.packet
  const client = packet.client
  const lastValidation = packet.validationResults[0]
  const isPending = req.status === "pending"
  const primaryDoc = packet.documents[0]
  const activity = await getAuditSummary("approval_request", requestId)

  return (
    <div className="space-y-6">
      <Link href="/approvals" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
        <ArrowLeft className="h-4 w-4" /> Back to Approvals
      </Link>

      {/* Approval status header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
                req.status === "approved" ? "bg-success-50" : req.status === "rejected" ? "bg-danger-50" : "bg-warning-50"
              }`}>
                <CheckSquare className={`h-6 w-6 ${
                  req.status === "approved" ? "text-success-600" : req.status === "rejected" ? "text-danger-600" : "text-warning-600"
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <h1 className="text-xl font-bold text-surface-900">Approval Request</h1>
                  <StatusChip status={req.status} size="lg" />
                </div>
                <p className="text-sm text-surface-500 mt-1">
                  Submitted {formatDate(req.submittedAt)} by {req.submittedBy.name || req.submittedBy.email}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/packets/${req.packetId}`}>
                <Button variant="secondary" size="sm"><FileText className="h-4 w-4" /> View Packet</Button>
              </Link>
              {lastValidation && (
                <Link href={`/validation/${lastValidation.id}`}>
                  <Button variant="secondary" size="sm"><Scale className="h-4 w-4" /> View Validation</Button>
                </Link>
              )}
              {primaryDoc && (
                <Link href={`/documents/${primaryDoc.id}/edit`}>
                  <Button variant="secondary" size="sm"><PenSquare className="h-4 w-4" /> Open PDF Editor</Button>
                </Link>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Packet / client / document context */}
      <Card>
        <CardContent className="p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Link href={`/clients/${packet.clientId}`} className="flex items-center gap-2 hover:text-brand-700">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 shrink-0">
                {client.firstName[0]}{client.lastName[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-surface-900">{client.firstName} {client.lastName}</p>
                <p className="text-xs text-surface-500 flex items-center gap-1"><Hash className="h-3 w-3" />{client.mcadId || "No 245D ID"}</p>
              </div>
            </Link>
            <Separator orientation="vertical" className="h-8" />
            <Link href={`/packets/${req.packetId}`} className="flex items-center gap-2 hover:text-brand-700">
              <FileText className="h-4 w-4 text-surface-400" />
              <div>
                <p className="text-sm font-medium text-surface-900">{packetTypeLabel(packet.packetType)}</p>
                <StatusChip status={packet.status} size="sm" />
              </div>
            </Link>
            <Separator orientation="vertical" className="h-8" />
            <span className="text-sm text-surface-500">{packet.documents.length} document{packet.documents.length === 1 ? "" : "s"} in packet</span>
            <ChevronRight className="ml-auto h-4 w-4 text-surface-300" />
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Validation summary */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Scale className="h-5 w-5 text-surface-400" />
                <CardTitle>Validation Summary</CardTitle>
              </div>
              {lastValidation && (
                <Link href={`/validation/${lastValidation.id}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                  View full report <ArrowRight className="inline h-3 w-3" />
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {lastValidation ? (
                <div className="flex items-center gap-4">
                  <Progress value={lastValidation.score} size="lg" variant={
                    lastValidation.score >= 80 ? "success" : lastValidation.score >= 50 ? "warning" : "danger"
                  } className="flex-1" label={`Compliance Score: ${lastValidation.score}%`} showValue />
                  <Badge variant={lastValidation.totalIssues === 0 ? "success" : "warning"} size="md">
                    {lastValidation.totalIssues} issue{lastValidation.totalIssues !== 1 ? "s" : ""}
                  </Badge>
                </div>
              ) : (
                <EmptyState title="Not validated yet" icon={<Scale className="h-6 w-6" />} />
              )}
            </CardContent>
          </Card>

          {/* Signature summary */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <PenSquare className="h-5 w-5 text-surface-400" />
                <CardTitle>Signatures</CardTitle>
                <CardDescription>{req.completedSignatureCount} completed, {req.pendingSignatureCount} pending</CardDescription>
              </div>
              <Link href={`/signatures?packetId=${req.packetId}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                View all <ArrowRight className="inline h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-2">
                <Progress value={req.completedSignatureCount + req.pendingSignatureCount > 0
                  ? Math.round((req.completedSignatureCount / (req.completedSignatureCount + req.pendingSignatureCount)) * 100) : 0}
                  size="sm" variant={req.pendingSignatureCount === 0 ? "success" : "warning"} className="flex-1" />
                <span className="text-xs text-surface-500">{req.completedSignatureCount}/{req.completedSignatureCount + req.pendingSignatureCount}</span>
              </div>
            </CardContent>
          </Card>

          {/* Documents */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-surface-400" />
                <CardTitle>Documents</CardTitle>
                <CardDescription>{packet.documents.length} in packet</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-1">
                {packet.documents.map((doc) => (
                  <Link key={doc.id} href={`/documents/${doc.id}/edit`} className="flex items-center justify-between rounded-lg border border-surface-100 p-3 hover:bg-surface-50 transition-colors">
                    <span className="text-sm text-surface-700">{doc.documentTemplate.name}</span>
                    <StatusChip status={doc.status} size="sm" />
                  </Link>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Approval timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Approval Timeline</CardTitle>
              <CardDescription>{req.events.length} event{req.events.length !== 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              {req.events.length === 0 ? (
                <EmptyState title="No events yet" icon={<Clock className="h-6 w-6" />} />
              ) : (
                <Timeline items={req.events.map((e) => ({
                  id: e.id,
                  title: e.eventType.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
                  description: e.notes || `by ${e.createdBy?.name || "System"}`,
                  timestamp: formatDateTime(e.createdAt),
                  status: e.eventType === "approved" ? "complete" as const : e.eventType === "rejected" || e.eventType === "cancelled" ? "error" as const : "current" as const,
                }))} />
              )}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-6">
          {/* Decision area */}
          {isPending && <ApprovalActions requestId={requestId} />}

          {/* Correction/rejection notes */}
          {req.decisionNotes && (
            <Card>
              <CardHeader><CardTitle>Decision Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-surface-700 whitespace-pre-wrap">{req.decisionNotes}</p></CardContent>
            </Card>
          )}

          {req.correctionReason && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <AlertTriangle className="h-5 w-5 text-warning-500" />
                  <CardTitle>Correction Required</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-warning-200 bg-warning-50 p-3 text-sm text-warning-800">
                  {req.correctionReason}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Approver / submitter cards */}
          <Card>
            <CardHeader><CardTitle>People</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar size="sm"><AvatarFallback name={req.submittedBy.name || req.submittedBy.email} className="bg-brand-100 text-brand-700 text-xs" /></Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-surface-900 truncate">{req.submittedBy.name || req.submittedBy.email}</p>
                  <p className="text-xs text-surface-500">Submitted by</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Avatar size="sm">
                  <AvatarFallback name={req.approver?.name || req.approver?.email || "?"} className="bg-surface-100 text-surface-500 text-xs" />
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-surface-900 truncate">{req.approver?.name || req.approver?.email || "Unassigned"}</p>
                  <p className="text-xs text-surface-500">{req.decidedAt ? "Decided by" : "Approver"}</p>
                </div>
              </div>
              {req.decidedAt && (
                <p className="text-xs text-surface-400 pt-1 border-t border-surface-100">Decided {formatDateTime(req.decidedAt)}</p>
              )}
            </CardContent>
          </Card>

          {/* Activity preview */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-surface-400" />
                <CardTitle>Activity</CardTitle>
              </div>
              <Link href={`/audit?targetType=approval_request&targetId=${requestId}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">
                View full trail <ArrowRight className="inline h-3 w-3" />
              </Link>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyState title="No activity yet" icon={<Clock className="h-6 w-6" />} />
              ) : (
                <div className="space-y-2">
                  {activity.slice(0, 6).map((e) => (
                    <div key={e.id} className="flex items-center gap-3 py-1.5 border-b border-surface-100 last:border-0">
                      <div className="flex h-6 w-6 items-center justify-center rounded-full bg-surface-100 shrink-0">
                        <Clock className="h-3 w-3 text-surface-400" />
                      </div>
                      <p className="flex-1 min-w-0 truncate text-xs text-surface-600">
                        <span className="font-medium text-surface-800">{e.actor?.name || "System"}</span>{" "}
                        {e.action.toLowerCase().replace(/_/g, " ")}
                      </p>
                      <span className="shrink-0 text-[11px] text-surface-400">{formatDate(e.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {isPending && (
            <form action={async () => { "use server"; await cancelApproval(requestId) }}>
              <Button type="submit" className="w-full" variant="danger">
                <X className="h-4 w-4" /> Cancel Request
              </Button>
            </form>
          )}
        </div>
      </div>
    </div>
  )
}

async function ApprovalActions({ requestId }: { requestId: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Decision</CardTitle>
        <CardDescription>Review and decide on this approval request</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <form action={async (formData: FormData) => {
          "use server"
          const notes = formData.get("notes") as string
          await decideApproval(requestId, "approved", notes)
        }}>
          <div className="space-y-2">
            <Textarea name="notes" placeholder="Approval notes (optional)" rows={2} />
            <Button type="submit" className="w-full">
              <CheckCircle2 className="h-4 w-4" /> Approve
            </Button>
          </div>
        </form>

        <Separator />

        <form action={async (formData: FormData) => {
          "use server"
          const notes = formData.get("notes") as string
          await decideApproval(requestId, "changes_requested", notes, formData.get("correctionReason") as string)
        }}>
          <div className="space-y-2">
            <Textarea name="notes" placeholder="Change request notes (optional)" rows={2} />
            <Input name="correctionReason" placeholder="What needs to be corrected?" />
            <Button type="submit" variant="secondary" className="w-full">
              <RefreshCw className="h-4 w-4" /> Request Changes
            </Button>
          </div>
        </form>

        <Separator />

        <form action={async (formData: FormData) => {
          "use server"
          const notes = formData.get("notes") as string
          await decideApproval(requestId, "rejected", notes)
        }}>
          <div className="space-y-2">
            <Textarea name="notes" placeholder="Rejection reason" rows={2} />
            <Button type="submit" variant="danger" className="w-full">
              <XCircle className="h-4 w-4" /> Reject
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
