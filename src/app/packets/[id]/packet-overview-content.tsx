import { getPacketById, updatePacketStatus } from "@/lib/actions/templates"
import { runPacketValidation, getValidationResults, getValidationResultDetail } from "@/lib/actions/validation"
import { createSignatureRequest, getSignatureRequests } from "@/lib/actions/signatures"
import { submitForApproval, getApprovalRequests, getApprovalDetail } from "@/lib/actions/approvals"
import { getAuditSummary } from "@/lib/actions/audit"
import { runPacketAnalysis, getAiRecommendations } from "@/lib/actions/ai"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Separator } from "@/components/ui/separator"
import {
  ArrowLeft, FileText, FolderOpen, User, Calendar, CheckCircle2, Shield, BrainCircuit, Lightbulb,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import Link from "next/link"
import {
  ValidationSummaryPanel, SignatureSummaryPanel, ApprovalStatusPanel, ActivityPreviewPanel,
} from "./packet-overview-panels"
import { PacketClientSummary } from "./packet-client-summary"
import { PacketProgressRadial } from "./packet-progress-radial"
import { PacketPriorityCard } from "./packet-priority-card"
import { PacketReadinessCard } from "./packet-readiness-card"
import { PacketDocumentsTable } from "./packet-documents-table"
import { PacketTimeline } from "./packet-timeline"
import { PacketActionBar } from "./packet-action-bar"
import { deriveReadiness, derivePriorityItem } from "./packet-overview-metrics"

interface Props { packetId: string }

const STATUS_FLOW = ["draft", "in_progress", "needs_validation", "validation_failed", "awaiting_signature", "awaiting_approval", "approved", "archived"]

function packetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

export async function PacketOverviewContent({ packetId }: Props) {
  let packet: Awaited<ReturnType<typeof getPacketById>>
  try {
    packet = await getPacketById(packetId)
  } catch (e) {
    return <ErrorState title="Access Denied" description="You do not have permission to view this packet." error={(e as Error).message} />
  }

  if (!packet) {
    return <EmptyState title="Packet not found" description="This packet may have been removed." icon={<FolderOpen className="h-8 w-8" />} />
  }

  const client = packet.client
  const docs = packet.documents
  const orgId = packet.organizationId

  const completedDocs = docs.filter((d) => d.status === "completed").length
  const inProgressDocs = docs.filter((d) => d.status === "in_progress" || d.status === "needs_review").length
  const notStartedDocs = docs.length - completedDocs - inProgressDocs
  const progressPct = docs.length ? Math.round((completedDocs / docs.length) * 100) : 0

  const currentIdx = STATUS_FLOW.indexOf(packet.status)
  const nextStatus = currentIdx >= 0 && currentIdx < STATUS_FLOW.length - 1 ? STATUS_FLOW[currentIdx + 1] : null

  const [validationList, signatures, approvals, activity, recommendations] = await Promise.all([
    getValidationResults(orgId, { packetId, pageSize: 1 }),
    getSignatureRequests(orgId, { packetId, pageSize: 20 }),
    getApprovalRequests(orgId, { packetId, pageSize: 1 }),
    getAuditSummary("packet", packetId),
    getAiRecommendations(orgId, { packetId, status: "open" }),
  ])

  const latestValidationId = validationList.results[0]?.id
  const latestApprovalId = approvals.requests[0]?.id

  const [validationDetail, approvalDetail] = await Promise.all([
    latestValidationId ? getValidationResultDetail(latestValidationId) : Promise.resolve(null),
    latestApprovalId ? getApprovalDetail(latestApprovalId) : Promise.resolve(null),
  ])

  const validationData = validationDetail ? {
    id: validationDetail.id,
    score: validationDetail.score,
    criticalCount: validationDetail.criticalCount,
    warningCount: validationDetail.warningCount,
    infoCount: validationDetail.infoCount,
    ranAt: validationDetail.ranAt,
    issues: validationDetail.issues.map((i) => ({ id: i.id, severity: i.severity, message: i.message, fieldName: i.fieldName })),
  } : null

  const approvalData = approvalDetail ? {
    id: approvalDetail.id,
    status: approvalDetail.status,
    submittedByName: approvalDetail.submittedBy?.name ?? null,
    approverName: approvalDetail.approver?.name ?? null,
    submittedAt: approvalDetail.submittedAt,
    decidedAt: approvalDetail.decidedAt,
    decisionNotes: approvalDetail.decisionNotes,
    pendingSignatureCount: approvalDetail.pendingSignatureCount,
    completedSignatureCount: approvalDetail.completedSignatureCount,
  } : null

  const activityItems = activity.map((e) => ({ id: e.id, action: e.action, actorName: e.actor?.name ?? null, createdAt: e.createdAt, targetType: e.targetType }))

  const primaryDoc = docs[0]
  const caseManager = client.assignments.find((a) => a.isPrimary) ?? client.assignments[0]

  const readiness = deriveReadiness(docs, validationData, signatures.requests, approvalData)
  const priorityItem = derivePriorityItem(packetId, docs, validationData, signatures.requests, approvalData)

  const tabs = [
    { label: "Overview", href: `/packets/${packetId}`, active: true },
    { label: "Documents", href: "#documents" },
    { label: "Signatures", href: `/signatures?packetId=${packetId}` },
    { label: "Validation", href: latestValidationId ? `/validation/${latestValidationId}` : "/validation" },
    { label: "Approvals", href: latestApprovalId ? `/approvals/${latestApprovalId}` : "/approvals" },
    { label: "History", href: "#activity" },
  ]

  async function handleRunValidation() {
    "use server"
    await runPacketValidation(packetId)
  }

  return (
    <div className="space-y-6 pb-4">
      {/* Breadcrumb */}
      <div className="flex items-center justify-between text-sm">
        <div className="flex items-center gap-1.5 text-surface-500">
          <Link href="/clients" className="hover:text-surface-700">Clients</Link>
          <span>/</span>
          <Link href={`/clients/${client.id}`} className="hover:text-surface-700">{client.firstName} {client.lastName}</Link>
          <span>/</span>
          <span className="text-surface-700">Packet</span>
        </div>
        <Link href="/packets" className="inline-flex items-center gap-1.5 text-surface-500 hover:text-surface-700">
          <ArrowLeft className="h-4 w-4" /> Back to Packets
        </Link>
      </div>

      {/* Header / client summary */}
      <Card>
        <CardContent className="p-6">
          <div className="flex flex-col gap-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50">
                <FolderOpen className="h-6 w-6 text-brand-600" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl font-bold text-surface-900">{packetTypeLabel(packet.packetType)}</h1>
                  <StatusChip status={packet.status} size="md" />
                </div>
                <p className="mt-1 text-sm text-surface-500">
                  Created {formatDate(packet.createdAt)} · Last updated {formatDate(packet.updatedAt)}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Link href={primaryDoc ? `/documents/${primaryDoc.id}/edit` : "#"}>
                <Button disabled={!primaryDoc}>
                  <FileText className="h-4 w-4" /> Open PDF Editor
                </Button>
              </Link>
              <form action={handleRunValidation}>
                <Button type="submit" variant="secondary">
                  <Shield className="h-4 w-4" /> Run Validation
                </Button>
              </form>
            </div>
          </div>

          <Separator className="my-4" />

          <PacketClientSummary
            clientId={client.id}
            firstName={client.firstName}
            lastName={client.lastName}
            mcadId={client.mcadId}
            programName={client.enrollments[0]?.program.name ?? null}
            caseManagerName={caseManager?.staff.name ?? null}
            diagnoses={client.diagnoses}
            dueDate={packet.dueDate}
          />
        </CardContent>
      </Card>

      {/* Tabs */}
      <div className="flex flex-wrap gap-1 border-b border-surface-200">
        {tabs.map((tab) => (
          <Link
            key={tab.label}
            href={tab.href}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${tab.active ? "border-brand-600 text-brand-700" : "border-transparent text-surface-500 hover:text-surface-700"}`}
          >
            {tab.label}
          </Link>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-6">
          <PacketProgressRadial
            completedDocs={completedDocs}
            inProgressDocs={inProgressDocs}
            notStartedDocs={notStartedDocs}
            totalDocs={docs.length}
            progressPct={progressPct}
          />

          <PacketPriorityCard item={priorityItem} />

          <PacketDocumentsTable docs={docs} completedDocs={completedDocs} />

          {/* Key dates */}
          <Card>
            <CardHeader>
              <div className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-surface-400" />
                <CardTitle>Key Dates</CardTitle>
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <InfoItem label="Created" value={formatDate(packet.createdAt)} />
                <InfoItem label="Due Date" value={packet.dueDate ? formatDate(packet.dueDate) : "Not set"} />
                <InfoItem label="Last Updated" value={formatDate(packet.updatedAt)} />
                <InfoItem label="Completed" value={packet.completedAt ? formatDate(packet.completedAt) : "—"} />
              </dl>
            </CardContent>
          </Card>

          <PacketTimeline events={activityItems} packetId={packetId} />
        </div>

        {/* Right column */}
        <div className="space-y-6">
          <PacketReadinessCard readiness={readiness} />

          <ValidationSummaryPanel data={validationData} packetId={packetId} />
          <SignatureSummaryPanel requests={signatures.requests} packetId={packetId} />
          <ApprovalStatusPanel data={approvalData} packetId={packetId} packetStatus={packet.status} />

          {recommendations.length > 0 && (
            <Card>
              <CardHeader className="flex-row items-center justify-between">
                <CardTitle className="flex items-center gap-2"><BrainCircuit className="h-5 w-5 text-surface-400" /> AI Recommendations</CardTitle>
                <Link href={`/ai-copilot?packetId=${packetId}`} className="text-sm font-medium text-brand-600 hover:text-brand-700">View all</Link>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2.5">
                  {recommendations.slice(0, 4).map((r) => (
                    <li key={r.id} className="flex items-start gap-2 text-sm text-surface-700">
                      <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                      {r.message}
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Contextual next-step actions */}
          <Card>
            <CardHeader><CardTitle>Next Steps</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <form action={async () => {
                "use server"
                await createSignatureRequest({
                  packetId, signerName: `${client.firstName} ${client.lastName}`,
                  signerEmail: client.email || "", signerRole: "Client", signerType: "client",
                })
              }}>
                <Button type="submit" className="w-full justify-start" variant="secondary">
                  <User className="h-4 w-4" /> Request Client Signature
                </Button>
              </form>
              {!approvalData || approvalData.status !== "pending" ? (
                <form action={async () => { "use server"; await submitForApproval(packetId) }}>
                  <Button type="submit" className="w-full justify-start" variant="secondary">
                    <CheckCircle2 className="h-4 w-4" /> Submit for Approval
                  </Button>
                </form>
              ) : null}
            </CardContent>
          </Card>

          {/* Secondary / less common actions */}
          <Card>
            <CardHeader><CardTitle>More Actions</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <form action={async () => { "use server"; await runPacketAnalysis(packetId) }}>
                <Button type="submit" className="w-full justify-start" variant="ghost">
                  <BrainCircuit className="h-4 w-4" /> Run AI Analysis
                </Button>
              </form>
              <Link href={`/ai-copilot?packetId=${packetId}`}>
                <Button className="w-full justify-start" variant="ghost">View AI Recommendations</Button>
              </Link>
              {nextStatus && (
                <form action={async () => { "use server"; await updatePacketStatus(packetId, nextStatus) }}>
                  <Button type="submit" className="w-full justify-start" variant="ghost">
                    Move to {packetTypeLabel(nextStatus)}
                  </Button>
                </form>
              )}
              {packet.status !== "archived" && (
                <form action={async () => { "use server"; await updatePacketStatus(packetId, "archived") }}>
                  <Button type="submit" className="w-full justify-start" variant="ghost">Archive Packet</Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <PacketActionBar
        status={packet.status}
        progressPct={progressPct}
        blockerCount={readiness.breakdown.pendingSignatures + readiness.breakdown.validationErrors + readiness.breakdown.incompleteDocuments + readiness.breakdown.pendingApproval}
        primaryDocId={primaryDoc?.id}
        packetId={packetId}
        onRunValidation={handleRunValidation}
      />
    </div>
  )
}

function InfoItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-surface-400">{label}</dt>
      <dd className="text-sm font-medium text-surface-700">{value}</dd>
    </div>
  )
}
