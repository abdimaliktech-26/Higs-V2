import { getValidationResultDetail, resolveValidationIssue } from "@/lib/actions/validation"
import { getAuditEvents } from "@/lib/actions/audit"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeft, ShieldCheck, AlertTriangle, AlertCircle, Info, Scale,
  CheckCircle2, Clock, User, FileText, ChevronRight, Hash, PenSquare,
} from "lucide-react"
import Link from "next/link"
import { formatDate, formatDateTime } from "@/lib/utils"

interface Props { resultId: string }

function packetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

function severityIcon(s: string) {
  switch (s) {
    case "critical": return <AlertCircle className="h-5 w-5 text-danger-500" />
    case "warning": return <AlertTriangle className="h-5 w-5 text-warning-500" />
    case "info": return <Info className="h-5 w-5 text-sky-500" />
    default: return <AlertCircle className="h-5 w-5 text-surface-400" />
  }
}

function severityBadge(s: string) {
  const map: Record<string, "danger" | "warning" | "default"> = { critical: "danger", warning: "warning", info: "default" }
  return <Badge variant={map[s] || "secondary"} size="sm" className="uppercase">{s}</Badge>
}

export async function ValidationResultContent({ resultId }: Props) {
  let result: Awaited<ReturnType<typeof getValidationResultDetail>>
  try {
    result = await getValidationResultDetail(resultId)
  } catch (e) {
    return <ErrorState title="Access Denied" description={(e as Error).message} />
  }
  if (!result) return <EmptyState title="Result not found" icon={<ShieldCheck className="h-8 w-8" />} />

  const openIssues = result.issues.filter((i) => i.status === "open")
  const resolvedIssues = result.issues.filter((i) => i.status === "resolved")
  const primaryDoc = result.packet?.documents[0]
  const issueIds = new Set(result.issues.map((i) => i.id))

  // Validation timeline: the run itself (packet-level) + resolutions of this result's issues.
  let activity: { id: string; action: string; actorName: string | null; createdAt: Date }[] = []
  if (result.packetId) {
    const [runEvents, resolveEvents] = await Promise.all([
      getAuditEvents(result.organizationId, { targetType: "packet", targetId: result.packetId, action: "VALIDATION_RUN", pageSize: 20 }),
      getAuditEvents(result.organizationId, { targetType: "validation_issue", pageSize: 50 }),
    ])
    activity = [...runEvents.events, ...resolveEvents.events.filter((e) => issueIds.has(e.targetId || ""))]
      .map((e) => ({ id: e.id, action: e.action, actorName: e.actor?.name ?? null, createdAt: e.createdAt }))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 8)
  }

  return (
    <div className="space-y-6">
      <Link href="/validation" className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
        <ArrowLeft className="h-4 w-4" /> Back to Validation Center
      </Link>

      {/* Compliance score header */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <div className={`flex h-14 w-14 items-center justify-center rounded-xl ${
                result.score >= 80 ? "bg-success-50" : result.score >= 50 ? "bg-warning-50" : "bg-danger-50"
              }`}>
                <Scale className={`h-7 w-7 ${
                  result.score >= 80 ? "text-success-600" : result.score >= 50 ? "text-warning-600" : "text-danger-600"
                }`} />
              </div>
              <div>
                <div className="flex items-center gap-3">
                  <p className="text-3xl font-bold text-surface-900">{result.score}%</p>
                  <span className={`text-sm font-medium ${
                    result.score >= 80 ? "text-success-600" : result.score >= 50 ? "text-warning-600" : "text-danger-600"
                  }`}>
                    {result.score >= 80 ? "Passing" : result.score >= 50 ? "Needs Review" : "Failing"}
                  </span>
                </div>
                {result.packet && (
                  <p className="text-sm text-surface-500 mt-1">
                    {result.packet.client.firstName} {result.packet.client.lastName} · {packetTypeLabel(result.packet.packetType)}
                  </p>
                )}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {result.packetId && (
                <Link href={`/packets/${result.packetId}`}>
                  <Button variant="secondary" size="sm"><FileText className="h-4 w-4" /> View Packet</Button>
                </Link>
              )}
              {primaryDoc && (
                <Link href={`/documents/${primaryDoc.id}/edit`}>
                  <Button variant="secondary" size="sm"><PenSquare className="h-4 w-4" /> Open PDF Editor</Button>
                </Link>
              )}
            </div>
          </div>

          <Separator className="my-4" />

          {/* Critical/warning/info issue summary */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg bg-danger-50 py-2 text-center">
              <p className="text-lg font-bold text-danger-600">{result.criticalCount}</p>
              <p className="text-xs text-danger-600">Critical</p>
            </div>
            <div className="rounded-lg bg-warning-50 py-2 text-center">
              <p className="text-lg font-bold text-warning-600">{result.warningCount}</p>
              <p className="text-xs text-warning-600">Warnings</p>
            </div>
            <div className="rounded-lg bg-sky-50 py-2 text-center">
              <p className="text-lg font-bold text-sky-600">{result.infoCount}</p>
              <p className="text-xs text-sky-600">Info</p>
            </div>
            <div className="rounded-lg bg-success-50 py-2 text-center">
              <p className="text-lg font-bold text-success-600">{resolvedIssues.length}</p>
              <p className="text-xs text-success-600">Resolved</p>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-6 text-sm text-surface-500">
            <span className="flex items-center gap-1.5"><User className="h-4 w-4" /> Ran by {result.ranBy.name || result.ranBy.email}</span>
            <span className="flex items-center gap-1.5"><Clock className="h-4 w-4" /> {formatDateTime(result.ranAt)}</span>
            <span className="flex items-center gap-1.5"><FileText className="h-4 w-4" /> {result.issues.length} issues</span>
            <Progress value={result.score} size="sm" variant={result.score >= 80 ? "success" : result.score >= 50 ? "warning" : "danger"} className="w-32 sm:ml-auto" />
          </div>
        </CardContent>
      </Card>

      {/* Packet / client / document context */}
      {result.packet && (
        <Card>
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
              <Link href={`/clients/${result.packet.clientId}`} className="flex items-center gap-2 hover:text-brand-700">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 shrink-0">
                  {result.packet.client.firstName[0]}{result.packet.client.lastName[0]}
                </div>
                <div>
                  <p className="text-sm font-medium text-surface-900">{result.packet.client.firstName} {result.packet.client.lastName}</p>
                  <p className="text-xs text-surface-500 flex items-center gap-1"><Hash className="h-3 w-3" />{result.packet.client.mcadId || "No 245D ID"}</p>
                </div>
              </Link>
              <Separator orientation="vertical" className="h-8" />
              <Link href={`/packets/${result.packetId}`} className="flex items-center gap-2 hover:text-brand-700">
                <FileText className="h-4 w-4 text-surface-400" />
                <div>
                  <p className="text-sm font-medium text-surface-900">{packetTypeLabel(result.packet.packetType)}</p>
                  <StatusChip status={result.packet.status} size="sm" />
                </div>
              </Link>
              {result.packet.documents.length > 0 && (
                <>
                  <Separator orientation="vertical" className="h-8" />
                  <span className="text-sm text-surface-500">{result.packet.documents.length} document{result.packet.documents.length === 1 ? "" : "s"} in packet</span>
                </>
              )}
              <ChevronRight className="ml-auto h-4 w-4 text-surface-300" />
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-6">
          {/* Open issues */}
          <Card>
            <CardHeader>
              <CardTitle>Issues ({openIssues.length} open)</CardTitle>
              <CardDescription>Items requiring attention before compliance can be confirmed</CardDescription>
            </CardHeader>
            <CardContent>
              {openIssues.length === 0 ? (
                <EmptyState title="No open issues" description="All validation checks passed for this packet" icon={<CheckCircle2 className="h-6 w-6 text-success-500" />} />
              ) : (
                <div className="space-y-3">
                  {openIssues.map((issue) => (
                    <div key={issue.id} className="rounded-lg border border-surface-100 p-4">
                      <div className="flex items-start gap-3">
                        <div className="mt-0.5">{severityIcon(issue.severity)}</div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-1">
                            {severityBadge(issue.severity)}
                            {issue.validationRule && <Badge variant="secondary" size="sm">{issue.validationRule.name}</Badge>}
                          </div>
                          <p className="text-sm font-medium text-surface-900">{issue.message}</p>
                          {issue.correction && (
                            <div className="mt-2 rounded-md bg-brand-50 border border-brand-100 px-3 py-2 text-xs text-brand-800">
                              <span className="font-medium">Correction: </span>{issue.correction}
                            </div>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            {issue.fieldName && <p className="text-xs text-surface-500">Field: {issue.fieldName}</p>}
                            {issue.targetType === "document" && issue.targetId && (
                              <Link href={`/documents/${issue.targetId}/edit`} className="text-xs font-medium text-brand-600 hover:text-brand-700">
                                Open document →
                              </Link>
                            )}
                          </div>
                        </div>
                        <form action={async () => { "use server"; await resolveValidationIssue(issue.id) }}>
                          <Button type="submit" variant="ghost" size="sm">
                            <CheckCircle2 className="h-4 w-4" /> Resolve
                          </Button>
                        </form>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Resolved issues */}
          {resolvedIssues.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>Resolved ({resolvedIssues.length})</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {resolvedIssues.map((issue) => (
                    <div key={issue.id} className="flex items-start gap-3 rounded-lg border border-success-100 bg-success-50/50 p-3">
                      <CheckCircle2 className="mt-0.5 h-5 w-5 text-success-500 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-surface-700 line-through opacity-70">{issue.message}</p>
                        <p className="text-xs text-success-600 mt-0.5">
                          Resolved by {issue.resolvedBy?.name || "Unknown"} · {issue.resolvedAt && formatDateTime(issue.resolvedAt)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Right column */}
        <div className="space-y-6">
          {/* Validation timeline / activity preview */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-surface-400" />
                <CardTitle>Validation Activity</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              {activity.length === 0 ? (
                <EmptyState title="No activity yet" icon={<Clock className="h-6 w-6" />} />
              ) : (
                <div className="space-y-2">
                  {activity.map((e) => (
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
              {result.packetId && (
                <Link href={`/audit?targetType=packet&targetId=${result.packetId}`} className="mt-3 inline-block text-xs font-medium text-brand-600 hover:text-brand-700">
                  View full audit trail →
                </Link>
              )}
            </CardContent>
          </Card>

          {/* Document list */}
          {result.packet && result.packet.documents.length > 0 && (
            <Card>
              <CardHeader><CardTitle>Documents</CardTitle></CardHeader>
              <CardContent className="space-y-1.5">
                {result.packet.documents.map((doc) => (
                  <Link key={doc.id} href={`/documents/${doc.id}/edit`} className="flex items-center gap-2 rounded-lg border border-surface-100 px-3 py-2 hover:bg-surface-50 transition-colors">
                    <FileText className="h-4 w-4 text-surface-400 shrink-0" />
                    <span className="text-sm text-surface-700 truncate">{doc.documentTemplate.name}</span>
                  </Link>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
