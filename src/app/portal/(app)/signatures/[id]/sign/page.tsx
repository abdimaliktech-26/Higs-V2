import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalSignatureRequestForClient } from "@/lib/actions/signatures"
import { derivePortalSignatureRequestState } from "@/lib/portal/signature-request-status"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { Building2, PenSquare, ArrowLeft, Mail } from "lucide-react"
import Link from "next/link"
import { formatDate } from "@/lib/utils"
import { SignatureExecutionForm } from "./signature-execution-form"

export const dynamic = "force-dynamic"

// Factual, non-legal explanations for each non-signable state — matching
// the exact tone/precedent already established by the staff signing page's
// own NON_SIGNABLE_MESSAGES (Step 5a.2).
const NOT_SIGNABLE_STATUS_MESSAGES: Record<string, string> = {
  signed: "This signature request has already been completed.",
  cancelled: "This signature request has been cancelled and cannot be signed.",
  declined: "This signature request was declined and cannot be signed.",
  pending: "This signature request is not yet ready for signing.",
}

// Extracted so tests can render the actual state-branching content
// directly — mocking only getPortalSignatureRequestForClient — without
// also mocking resolvePortalPageContext or PortalShell's next/navigation
// hooks. Mirrors the same content/shell split already established by
// PortalAuthorizationBody (Step 5b.2) and SignaturePageContent (5a.2).
export async function PortalSignatureBody({ requestId, clientId, dashboardHref }: { requestId: string; clientId: string; dashboardHref: string }) {
  const request = await getPortalSignatureRequestForClient(requestId, clientId)
  const state = derivePortalSignatureRequestState(request)

  const backLink = (
    <Link href={dashboardHref} className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
      <ArrowLeft className="h-4 w-4" /> Back to Dashboard
    </Link>
  )

  if (state === "NOT_FOUND") {
    return (
      <div className="space-y-6">
        {backLink}
        <EmptyState title="Signature request not found" icon={<PenSquare className="h-8 w-8" />} />
      </div>
    )
  }

  if (!request) return null // unreachable once state !== "NOT_FOUND", narrows the type below

  if (state === "NOT_SIGNABLE_STATUS") {
    return (
      <div className="space-y-6">
        {backLink}
        <EmptyState title={NOT_SIGNABLE_STATUS_MESSAGES[request.status] || "This signature request cannot be signed right now."} icon={<PenSquare className="h-8 w-8" />} />
      </div>
    )
  }

  if (state === "NOT_ELIGIBLE") {
    return (
      <div className="space-y-6">
        {backLink}
        <EmptyState
          title="You are not yet able to sign this request."
          description={
            request.ineligibleReason === "not_enabled"
              ? "Staff has not yet enabled signing permission for your account on this client."
              : "Your signing authorization is not currently accepted and effective."
          }
          icon={<PenSquare className="h-8 w-8" />}
        />
      </div>
    )
  }

  if (state === "MISSING_CONSENT") {
    return (
      <div className="space-y-6">
        {backLink}
        <EmptyState
          title="This request has no consent language configured and cannot be signed yet."
          description="Contact your care team if you believe this is a mistake."
          icon={<PenSquare className="h-8 w-8" />}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {backLink}

      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-xl font-bold text-surface-900">Electronic Signature</h1>
        {request.isOverdue && <Badge variant="danger" size="sm">Overdue</Badge>}
      </div>

      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Document</p>
          <p className="text-sm text-surface-900">{request.clientDisplayName}{request.packetType ? ` — ${request.packetType.replace(/_/g, " ")}` : ""}</p>
          {request.documentName && <p className="text-sm text-surface-700">{request.documentName}</p>}
          {request.dueDate && <p className="text-xs text-surface-500">Due {formatDate(request.dueDate)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Signer</p>
          <p className="text-sm font-medium text-surface-900">{request.signerName}</p>
          <p className="flex items-center gap-1.5 text-sm text-surface-500"><Mail className="h-3.5 w-3.5" /> Signing through the client portal</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Consent</p>
          <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm text-surface-700 whitespace-pre-wrap">
            {request.consentText}
          </div>
        </CardContent>
      </Card>

      <SignatureExecutionForm requestId={requestId} clientId={clientId} expectedSignerName={request.signerName} />
    </div>
  )
}

export default async function PortalSignatureSignPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ client?: string }> }) {
  const { id } = await params
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <PortalSignatureBody requestId={id} clientId={currentClientId} dashboardHref={`/portal/dashboard?client=${currentClientId}`} />
    </PortalShell>
  )
}
