import { getAuditEventDetail } from "@/lib/actions/audit"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeft, User, Clock, Target, FileText, Shield, Info,
  ExternalLink, ChevronRight
} from "lucide-react"
import Link from "next/link"
import { formatDateTime } from "@/lib/utils"

interface Props { eventId: string }

const severityMap: Record<string, "info" | "warning" | "success" | "danger" | "default"> = {
  LOGIN: "info", LOGOUT: "info", CLIENT_CREATED: "success", CLIENT_ARCHIVED: "warning",
  APPROVAL_APPROVED: "success", APPROVAL_REJECTED: "danger", ACCESS_DENIED: "danger",
  VALIDATION_ISSUE_CREATED: "warning", VALIDATION_ISSUE_RESOLVED: "success",
  SIGNATURE_COMPLETED: "success", SIGNATURE_DECLINED: "danger",
}

const actionDescriptions: Record<string, string> = {
  LOGIN: "User logged in to the system",
  LOGOUT: "User logged out",
  ORGANIZATION_SWITCH: "User switched organization context",
  CLIENT_VIEWED: "Client record was accessed",
  CLIENT_CREATED: "New client record created",
  CLIENT_UPDATED: "Client record modified",
  CLIENT_ARCHIVED: "Client record archived",
  STAFF_ASSIGNED: "Staff member assigned to client",
  STAFF_UNASSIGNED: "Staff member removed from client",
  CONTACT_ADDED: "Contact/guardian added",
  CONTACT_UPDATED: "Contact/guardian updated",
  CONTACT_REMOVED: "Contact/guardian removed",
  PACKET_VIEWED: "Packet was accessed",
  PACKET_CREATED: "New packet created",
  PACKET_STATUS_CHANGED: "Packet status updated",
  PACKET_DOCUMENT_STATUS_CHANGED: "Document status updated",
  DOCUMENT_VIEWED: "Document was opened",
  DOCUMENT_SAVED: "Document changes saved",
  DOCUMENT_FIELD_ADDED: "Form field added to document",
  DOCUMENT_FIELD_UPDATED: "Form field value updated",
  PDF_VERSION_CREATED: "New PDF version saved",
  DOCUMENT_COMMENT_ADDED: "Comment added to document",
  TEMPLATE_UPLOADED: "New form template uploaded",
  TEMPLATE_ACTIVATED: "Form template activated",
  TEMPLATE_RETIRED: "Form template retired",
  PACKET_TEMPLATE_CREATED: "New packet template defined",
  VALIDATION_RUN: "Compliance validation executed",
  VALIDATION_ISSUE_CREATED: "Validation issue detected",
  VALIDATION_ISSUE_RESOLVED: "Validation issue resolved",
  COMPLIANCE_SCORE_UPDATED: "Compliance score recalculated",
  SIGNATURE_REQUESTED: "Signature requested from signer",
  SIGNATURE_SENT: "Signature request sent to signer",
  SIGNATURE_VIEWED: "Signer viewed signature request",
  SIGNATURE_COMPLETED: "Signature completed",
  SIGNATURE_DECLINED: "Signature declined",
  SIGNATURE_CANCELLED: "Signature request cancelled",
  APPROVAL_SUBMITTED: "Packet submitted for approval",
  APPROVAL_APPROVED: "Approval granted",
  APPROVAL_REJECTED: "Approval rejected",
  APPROVAL_CHANGES_REQUESTED: "Changes requested during approval",
  APPROVAL_CANCELLED: "Approval request cancelled",
  DOCUMENT_LOCKED: "Document locked after approval",
  ACCESS_DENIED: "Access attempt denied",
}

export async function AuditEventDetailContent({ eventId }: Props) {
  let event: Awaited<ReturnType<typeof getAuditEventDetail>>
  try {
    event = await getAuditEventDetail(eventId)
  } catch (e) {
    return <ErrorState title="Access Denied" description={(e as Error).message} />
  }
  if (!event) return <EmptyState title="Event not found" icon={<Info className="h-8 w-8" />} />

  const meta = event.metadata as Record<string, unknown> | null
  const severity = severityMap[event.action] || "default"

  const targetLinks: Record<string, string> = {
    client: "/clients/",
    packet: "/packets/",
    packet_document: "/documents/",
    signature_request: "/signatures/",
    approval_request: "/approvals/",
    validation_issue: "/validation/",
    user: "/settings/users/",
  }

  return (
    <div className="space-y-6">
      <Link href="/audit" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
        <ArrowLeft className="h-4 w-4" /> Back to Audit Center
      </Link>

      <Card>
        <CardContent className="p-6">
          <div className="flex items-start gap-4">
            <div className={`flex h-12 w-12 items-center justify-center rounded-xl ${
              severity === "danger" ? "bg-danger-50" : severity === "warning" ? "bg-warning-50" : severity === "success" ? "bg-success-50" : "bg-brand-50"
            }`}>
              <Shield className={`h-6 w-6 ${
                severity === "danger" ? "text-danger-600" : severity === "warning" ? "text-warning-600" : severity === "success" ? "text-success-600" : "text-brand-600"
              }`} />
            </div>
            <div className="flex-1">
              <div className="flex items-center gap-3">
                <h1 className="text-xl font-bold text-surface-900">{event.action.replace(/_/g, " ")}</h1>
                <Badge variant={severity} size="md">{event.action}</Badge>
              </div>
              <p className="text-sm text-surface-500 mt-1">{actionDescriptions[event.action] || "Audit event recorded"}</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Event Details</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-surface-500">Event ID</span><span className="text-surface-700 font-mono text-xs">{event.id}</span></div>
              <div className="flex justify-between"><span className="text-surface-500">Action</span><Badge variant={severity} size="sm">{event.action.replace(/_/g, " ")}</Badge></div>
              <div className="flex justify-between"><span className="text-surface-500">Timestamp</span><span className="text-surface-700">{formatDateTime(event.createdAt)}</span></div>
              <div className="flex justify-between"><span className="text-surface-500">Organization</span><span className="text-surface-700">{event.organization?.name || "—"}</span></div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Actor</CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><span className="text-surface-500">Name</span><span className="text-surface-700">{event.actor?.name || "System"}</span></div>
              <div className="flex justify-between"><span className="text-surface-500">Email</span><span className="text-surface-700">{event.actor?.email || "—"}</span></div>
              <div className="flex justify-between"><span className="text-surface-500">Actor ID</span><span className="text-surface-700 font-mono text-xs">{event.actorId || "—"}</span></div>
            </dl>
          </CardContent>
        </Card>

        {event.targetType && (
          <Card>
            <CardHeader>
              <CardTitle>Target</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-surface-500">Type</span><span className="text-surface-700 capitalize">{event.targetType}</span></div>
                <div className="flex justify-between"><span className="text-surface-500">ID</span><span className="text-surface-700 font-mono text-xs">{event.targetId}</span></div>
                {event.targetId && targetLinks[event.targetType] && (
                  <Link href={`${targetLinks[event.targetType]}${event.targetId}`}
                    className="inline-flex items-center gap-1 text-brand-600 hover:text-brand-700 text-sm mt-2">
                    View related {event.targetType} <ExternalLink className="h-3 w-3" />
                  </Link>
                )}
              </dl>
            </CardContent>
          </Card>
        )}

        {event.ipAddress && (
          <Card>
            <CardHeader>
              <CardTitle>Request Info</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="space-y-3 text-sm">
                <div className="flex justify-between"><span className="text-surface-500">IP Address</span><span className="text-surface-700 font-mono text-xs">{event.ipAddress}</span></div>
                {event.userAgent && <div className="flex justify-between"><span className="text-surface-500">User Agent</span><span className="text-surface-500 text-xs truncate max-w-[200px]" title={event.userAgent}>{event.userAgent}</span></div>}
              </dl>
            </CardContent>
          </Card>
        )}
      </div>

      {meta && Object.keys(meta).length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Metadata</CardTitle>
            <CardDescription>Additional event context</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-4">
              <pre className="text-xs text-surface-700 whitespace-pre-wrap font-mono">{JSON.stringify(meta, null, 2)}</pre>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
