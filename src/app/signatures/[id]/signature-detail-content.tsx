import { getSignatureDetail, updateSignatureStatus } from "@/lib/actions/signatures"
import { getAuditSummary } from "@/lib/actions/audit"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Timeline } from "@/components/ui/timeline"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import {
  ArrowLeft, Mail, FileText, Calendar, Clock, Shield,
  CheckCircle2, XCircle, Send, Eye, PenSquare, AlertTriangle, ChevronRight, Hash,
} from "lucide-react"
import Link from "next/link"
import { formatDate, formatDateTime } from "@/lib/utils"

interface Props { requestId: string }

function packetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

export async function SignatureDetailContent({ requestId }: Props) {
  let req: Awaited<ReturnType<typeof getSignatureDetail>>
  try {
    req = await getSignatureDetail(requestId)
  } catch (e) {
    return <ErrorState title="Access Denied" description={(e as Error).message} />
  }
  if (!req) return <EmptyState title="Signature request not found" icon={<PenSquare className="h-8 w-8" />} />

  const activity = await getAuditSummary("signature_request", requestId)

  const statusActions: Record<string, { label: string; status: string; variant?: "primary" | "secondary" | "danger"; icon: React.ReactNode }[]> = {
    pending: [
      { label: "Send Request", status: "sent", icon: <Send className="h-4 w-4" /> },
      { label: "Cancel", status: "cancelled", variant: "danger", icon: <XCircle className="h-4 w-4" /> },
    ],
    sent: [
      { label: "Mark Viewed", status: "viewed", icon: <Eye className="h-4 w-4" /> },
      { label: "Complete Signature", status: "signed", variant: "primary", icon: <CheckCircle2 className="h-4 w-4" /> },
      { label: "Decline", status: "declined", variant: "danger", icon: <XCircle className="h-4 w-4" /> },
    ],
    viewed: [
      { label: "Complete Signature", status: "signed", icon: <CheckCircle2 className="h-4 w-4" /> },
      { label: "Decline", status: "declined", variant: "danger", icon: <XCircle className="h-4 w-4" /> },
    ],
  }
  const actions = statusActions[req.status] || []

  const viewedEvent = req.events.find((e) => e.eventType === "viewed")
  const sentEvent = req.events.find((e) => e.eventType === "sent")

  const now = new Date()
  const isOverdue = req.dueDate && req.dueDate < now && !["signed", "declined", "cancelled"].includes(req.status)
  const daysUntilDue = req.dueDate ? Math.ceil((req.dueDate.getTime() - now.getTime()) / 86400000) : null

  return (
    <div className="space-y-6">
      <Link href="/signatures" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
        <ArrowLeft className="h-4 w-4" /> Back to Signatures
      </Link>

      {/* Signer identity / status header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <Avatar size="lg">
                <AvatarFallback name={req.signerName} className="bg-brand-100 text-brand-700 font-bold" />
              </Avatar>
              <div>
                <div className="flex items-center gap-3 flex-wrap">
                  <h1 className="text-xl font-bold text-surface-900">{req.signerName}</h1>
                  <StatusChip status={req.status} size="md" />
                  {isOverdue && <Badge variant="danger" size="sm">Overdue</Badge>}
                </div>
                <p className="text-sm text-surface-500 mt-1 capitalize">{req.signerRole.replace(/_/g, " ")} · {req.signerType}</p>
                <p className="text-sm text-surface-500 flex items-center gap-1.5 mt-0.5"><Mail className="h-3.5 w-3.5" />{req.signerEmail}</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {actions.map((action) => (
                <form key={action.status} action={async () => {
                  "use server"
                  await updateSignatureStatus(requestId, action.status)
                }}>
                  <Button type="submit" variant={action.variant || "secondary"} size="sm">
                    {action.icon} {action.label}
                  </Button>
                </form>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Packet / client / document context */}
      {req.packet && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href={`/clients/${req.packet.clientId}`} className="flex items-center gap-2 hover:text-brand-700">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 shrink-0">
                  {req.packet.client.firstName[0]}{req.packet.client.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-900">{req.packet.client.firstName} {req.packet.client.lastName}</p>
                  <p className="text-xs text-surface-500 flex items-center gap-1"><Hash className="h-3 w-3" />{req.packet.client.mcadId || "No 245D ID"}</p>
                </div>
              </Link>
              <Separator orientation="vertical" className="h-8" />
              <Link href={`/packets/${req.packetId}`} className="flex items-center gap-2 hover:text-brand-700">
                <FileText className="h-4 w-4 text-surface-400" />
                <div>
                  <p className="text-sm font-medium text-surface-900">{packetTypeLabel(req.packet.packetType)}</p>
                  <StatusChip status={req.packet.status} size="sm" />
                </div>
              </Link>
              {req.packetDocument && (
                <>
                  <Separator orientation="vertical" className="h-8" />
                  <Link href={`/documents/${req.packetDocumentId}/edit`} className="flex items-center gap-2 hover:text-brand-700">
                    <PenSquare className="h-4 w-4 text-surface-400" />
                    <span className="text-sm text-surface-700">{req.packetDocument.documentTemplate.name}</span>
                  </Link>
                </>
              )}
              <ChevronRight className="ml-auto h-4 w-4 text-surface-300" />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          {/* Signer card */}
          <Card>
            <CardHeader>
              <CardTitle>Signer</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
                <div><dt className="text-surface-500">Date Sent</dt><dd className="font-medium text-surface-900">{sentEvent ? formatDate(sentEvent.createdAt) : "Not sent"}</dd></div>
                <div><dt className="text-surface-500">Date Viewed</dt><dd className="font-medium text-surface-900">{viewedEvent ? formatDate(viewedEvent.createdAt) : "—"}</dd></div>
                <div><dt className="text-surface-500">Date Signed</dt><dd className="font-medium text-surface-900">{req.signedAt ? formatDate(req.signedAt) : "—"}</dd></div>
                <div><dt className="text-surface-500">Requested By</dt><dd className="font-medium text-surface-900">{req.requestedBy.name || req.requestedBy.email}</dd></div>
                <div><dt className="text-surface-500">Events Logged</dt><dd className="font-medium text-surface-900">{req.events.length}</dd></div>
                {req.declineReason && <div className="col-span-2"><dt className="text-surface-500">Decline Reason</dt><dd className="font-medium text-danger-600">{req.declineReason}</dd></div>}
              </dl>
            </CardContent>
          </Card>

          {/* Consent */}
          {req.consentText && (
            <Card>
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Shield className="h-5 w-5 text-surface-400" />
                  <CardTitle>Consent</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm text-surface-700 whitespace-pre-wrap">
                  {req.consentText}
                </div>
                {req.status === "signed" && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-success-700">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Consent recorded at time of signature
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* Signature status timeline */}
          <Card>
            <CardHeader>
              <CardTitle>Signature Status Timeline</CardTitle>
              <CardDescription>{req.events.length} event{req.events.length !== 1 ? "s" : ""}</CardDescription>
            </CardHeader>
            <CardContent>
              {req.events.length === 0 ? (
                <EmptyState title="No events yet" description="Timeline updates as the request is sent, viewed, and signed" icon={<Clock className="h-6 w-6" />} />
              ) : (
                <Timeline
                  items={req.events.map((e) => ({
                    id: e.id,
                    title: e.eventType.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase()),
                    description: `by ${e.createdBy?.name || "System"}`,
                    timestamp: formatDateTime(e.createdAt),
                    status: e.eventType === "signed" ? "complete" as const : e.eventType === "declined" || e.eventType === "cancelled" ? "error" as const : "current" as const,
                  }))}
                />
              )}
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Due date */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-surface-400" />
                <CardTitle>Due Date</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {req.dueDate ? (
                <>
                  <p className="text-lg font-bold text-surface-900">{formatDate(req.dueDate)}</p>
                  <p className={`mt-1 text-sm ${isOverdue ? "text-danger-600 font-medium" : "text-surface-500"}`}>
                    {isOverdue
                      ? `${Math.abs(daysUntilDue!)} day${Math.abs(daysUntilDue!) === 1 ? "" : "s"} overdue`
                      : daysUntilDue !== null && ["signed", "declined", "cancelled"].includes(req.status) === false
                        ? `${daysUntilDue} day${daysUntilDue === 1 ? "" : "s"} remaining`
                        : null}
                  </p>
                </>
              ) : (
                <p className="text-sm text-surface-500">No due date set</p>
              )}
              <p className="mt-3 text-xs text-surface-400">
                Reminder scheduling is not yet built — this pass only surfaces the due date that already exists on the request.
              </p>
            </CardContent>
          </Card>

          {/* Document preview */}
          {req.packetDocument ? (
            <Card>
              <CardHeader>
                <CardTitle>Document</CardTitle>
              </CardHeader>
              <CardContent>
                <Link href={`/documents/${req.packetDocumentId}/edit`} className="flex items-center gap-3 rounded-lg border border-surface-200 p-3 hover:bg-surface-50 transition-colors">
                  <div className="flex h-12 w-9 items-center justify-center rounded border border-surface-200 bg-white shrink-0">
                    <FileText className="h-5 w-5 text-surface-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-surface-900 truncate">{req.packetDocument.documentTemplate.name}</p>
                    <p className="text-xs text-brand-600">Open in PDF Editor →</p>
                  </div>
                </Link>
                {req.pdfField && (
                  <div className="mt-3 border-t border-surface-100 pt-3">
                    <p className="text-xs text-surface-500">Signature Field</p>
                    <p className="text-sm font-medium text-surface-900">{req.pdfField.name}</p>
                    {req.status === "signed" && req.pdfField.value && (
                      <div className="mt-2 rounded-md border border-success-200 bg-success-50 px-3 py-2 text-sm text-success-800">
                        Signed value: {req.pdfField.value}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader><CardTitle>Document</CardTitle></CardHeader>
              <CardContent>
                <EmptyState title="No document linked" description="This signature request isn't tied to a specific packet document" icon={<FileText className="h-6 w-6" />} />
              </CardContent>
            </Card>
          )}

          {/* Activity / audit preview */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-surface-400" />
                <CardTitle>Activity</CardTitle>
              </div>
              <Link href={`/audit?targetType=signature_request&targetId=${requestId}`}>
                <span className="text-sm font-medium text-brand-600 hover:text-brand-700">View full trail</span>
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

          {req.notes && (
            <Card>
              <CardHeader><CardTitle>Notes</CardTitle></CardHeader>
              <CardContent><p className="text-sm text-surface-600">{req.notes}</p></CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
