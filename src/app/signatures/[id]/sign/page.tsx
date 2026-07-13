import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import Link from "next/link"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { getSignatureDetail } from "@/lib/actions/signatures"
import { SignatureExecutionForm } from "./signature-execution-form"
import { PageSkeleton, EmptyState, ErrorState } from "@/components/ui/states"
import { Card, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { ArrowLeft, PenSquare, Mail, Shield } from "lucide-react"
import { formatDate } from "@/lib/utils"

export const dynamic = "force-dynamic"

interface Props { params: Promise<{ id: string }> }

// Step 5a.2 — statuses that never accept an execution attempt, and the
// factual (non-legal, non-exaggerated) explanation shown for each. "signed"
// is included so an already-completed request shows the same plain
// explanation here as everywhere else, rather than re-deriving one.
const NON_SIGNABLE_MESSAGES: Record<string, string> = {
  signed: "This signature request has already been completed.",
  cancelled: "This signature request has been cancelled and cannot be signed.",
  declined: "This signature request was declined and cannot be signed.",
  pending: "This signature request is not yet ready for signing.",
}

// The single fetch this page needs — reused from Step 5a.1's own read
// action, never duplicated. Every guard below is a pre-render UX
// convenience only: executeStaffSignature (called exclusively by the
// client form below) independently re-verifies every one of these
// conditions itself and remains the sole authorization/integrity boundary.
export async function SignaturePageContent({ requestId }: { requestId: string }) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  let req: Awaited<ReturnType<typeof getSignatureDetail>>
  try {
    req = await getSignatureDetail(requestId)
  } catch (e) {
    return <ErrorState title="Access Denied" description={(e as Error).message} />
  }
  if (!req) return <EmptyState title="Signature request not found" icon={<PenSquare className="h-8 w-8" />} />

  const backLink = (
    <Link href={`/signatures/${requestId}`} className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
      <ArrowLeft className="h-4 w-4" /> Back to Signature Request
    </Link>
  )

  const heading = (
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-xl font-bold text-surface-900">Electronic Signature</h1>
      <StatusChip status={req.status} size="md" />
    </div>
  )

  const actingEmail = ((session.user as { email?: string }).email || "").trim().toLowerCase()
  const signerEmail = (req.signerEmail || "").trim().toLowerCase()

  // Email-mismatch guard: never render the form, never reveal anything
  // beyond what the existing detail page already shows this user.
  if (!signerEmail || actingEmail !== signerEmail) {
    return (
      <div className="space-y-6">
        {backLink}
        {heading}
        <EmptyState
          title="This signature request is assigned to a different signer."
          icon={<Shield className="h-8 w-8" />}
        />
      </div>
    )
  }

  // Non-signable status guard.
  if (req.status !== "sent" && req.status !== "viewed") {
    return (
      <div className="space-y-6">
        {backLink}
        {heading}
        <EmptyState
          title={NON_SIGNABLE_MESSAGES[req.status] || "This signature request cannot be signed right now."}
          icon={<PenSquare className="h-8 w-8" />}
        />
      </div>
    )
  }

  // Missing/blank consent text — no fallback consent language is inserted
  // here or anywhere in this step; an existing request without real
  // consent language on file is not safe to execute.
  if (!req.consentText || !req.consentText.trim()) {
    return (
      <div className="space-y-6">
        {backLink}
        {heading}
        <EmptyState
          title="This request has no consent language configured and cannot be signed yet."
          description="Contact an administrator to add consent language to this signature request before it can be executed."
          icon={<Shield className="h-8 w-8" />}
        />
      </div>
    )
  }

  // Required linked context missing — nothing meaningful to sign against.
  if (!req.packetDocumentId || !req.pdfField) {
    return (
      <div className="space-y-6">
        {backLink}
        {heading}
        <EmptyState
          title="This request is not linked to a signature field and cannot be signed here."
          icon={<PenSquare className="h-8 w-8" />}
        />
      </div>
    )
  }

  const now = new Date()
  const isOverdue = Boolean(req.dueDate && req.dueDate < now)

  return (
    <div className="space-y-6">
      {backLink}
      {heading}

      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Signer</p>
          <p className="text-sm font-medium text-surface-900">{req.signerName}</p>
          <p className="flex items-center gap-1.5 text-sm text-surface-500"><Mail className="h-3.5 w-3.5" />{req.signerEmail}</p>
          <p className="text-sm capitalize text-surface-500">{req.signerRole.replace(/_/g, " ")}{req.signerType ? ` · ${req.signerType}` : ""}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-1 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Document</p>
          {req.packet && (
            <p className="text-sm text-surface-900">{req.packet.client.firstName} {req.packet.client.lastName} — {req.packet.packetType.replace(/_/g, " ")}</p>
          )}
          {req.packetDocument && <p className="text-sm text-surface-700">{req.packetDocument.documentTemplate.name}</p>}
          <div className="flex flex-wrap items-center gap-2 pt-1">
            {req.dueDate && <span className="text-xs text-surface-500">Due {formatDate(req.dueDate)}</span>}
            {isOverdue && <Badge variant="danger" size="sm">Overdue</Badge>}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Consent</p>
          <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm text-surface-700 whitespace-pre-wrap">
            {req.consentText}
          </div>
        </CardContent>
      </Card>

      <SignatureExecutionForm
        requestId={requestId}
        expectedSignerName={req.signerName}
      />
    </div>
  )
}

export default async function SignatureSignPage({ params }: Props) {
  const session = await auth()
  if (!session) redirect("/login")
  const { id } = await params

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <SignaturePageContent requestId={id} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
