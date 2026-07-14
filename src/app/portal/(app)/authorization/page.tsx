import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalAccessAuthorizationForClient } from "@/lib/actions/portal-access-authorizations"
import { derivePortalAuthorizationState } from "@/lib/portal/authorization-status"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { Building2, ShieldCheck, ArrowLeft } from "lucide-react"
import Link from "next/link"
import { formatDate } from "@/lib/utils"
import { AuthorizationAcceptanceForm } from "./authorization-acceptance-form"

export const dynamic = "force-dynamic"

const authorityTypeLabels: Record<string, string> = {
  SELF: "Self",
  PARENT_OF_MINOR: "Parent of a Minor",
  LEGAL_GUARDIAN: "Legal Guardian",
  POWER_OF_ATTORNEY: "Power of Attorney",
  CONSERVATOR: "Conservator",
  ORG_DESIGNATED: "Organization-Designated",
}
const accessRoleLabels: Record<string, string> = {
  GUARDIAN: "Guardian",
  PARENT: "Parent",
  RESPONSIBLE_PARTY: "Responsible Party",
  AUTHORIZED_REPRESENTATIVE: "Authorized Representative",
  CLIENT_SELF: "Client (self)",
}

// Extracted so tests can render the actual state-branching content directly
// — mocking only getPortalAccessAuthorizationForClient — without also
// having to mock resolvePortalPageContext, PortalShell's next/navigation
// hooks, or portalLogout. Mirrors the same content/shell split already
// established by SignaturePageContent (Step 5a.2).
export async function PortalAuthorizationBody({
  clientId, clientDisplayName, dashboardHref,
}: { clientId: string; clientDisplayName: string; dashboardHref: string }) {
  const authorization = await getPortalAccessAuthorizationForClient(clientId)
  const state = derivePortalAuthorizationState(authorization, new Date())

  return (
    <div className="space-y-6">
      <div>
        <Link href={dashboardHref} className="inline-flex items-center gap-1.5 text-sm text-surface-500 hover:text-surface-700">
          <ArrowLeft className="h-4 w-4" /> Back to Dashboard
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-surface-900">Review Signing Authorization</h1>
        {clientDisplayName && (
          <p className="mt-1 text-sm text-surface-500">You are reviewing signing authority for {clientDisplayName}.</p>
        )}
      </div>

      {state === "NONE" && (
        <EmptyState title="No signing authorization to review" description="There is nothing awaiting your review right now." icon={<ShieldCheck className="h-8 w-8" />} />
      )}

      {state === "REVOKED" && (
        <EmptyState title="This signing authorization has been revoked and can no longer be accepted." icon={<ShieldCheck className="h-8 w-8" />} />
      )}

      {state === "EXPIRED" && (
        <EmptyState title="This signing authorization has expired." icon={<ShieldCheck className="h-8 w-8" />} />
      )}

      {state === "PENDING_FUTURE" && authorization && (
        <EmptyState
          title="This signing authorization is not yet available for acceptance."
          description={`It becomes available on ${formatDate(authorization.effectiveDate)}.`}
          icon={<ShieldCheck className="h-8 w-8" />}
        />
      )}

      {state === "ACCEPTED" && authorization && (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-sm font-medium text-surface-900">You have already accepted this signing authorization.</p>
            <p className="text-sm text-surface-600">
              {authorization.grantCanSignDocuments
                ? "Signing permission is currently enabled for this client."
                : "Signing permission has not yet been enabled by staff. You'll be able to sign once it is."}
            </p>
          </CardContent>
        </Card>
      )}

      {state === "PENDING_ACTIONABLE" && authorization && (
        <>
          <Card>
            <CardContent className="space-y-2 p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Authority Context</p>
              <p className="text-sm text-surface-900">Authority type: {authorityTypeLabels[authorization.authorityType] || authorization.authorityType}</p>
              <p className="text-sm text-surface-700">
                Access role: {accessRoleLabels[authorization.accessRole] || authorization.accessRole}
                {authorization.relationship ? ` · ${authorization.relationship}` : ""}
              </p>
              <p className="text-sm text-surface-700">Effective {formatDate(authorization.effectiveDate)}{authorization.expirationDate ? ` – ${formatDate(authorization.expirationDate)}` : " – No expiration"}</p>
              {authorization.hasSupportingDocument && (
                <p className="text-sm text-surface-700">Supporting documentation is on file.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent className="space-y-2 p-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-surface-400">Consent Statement</h2>
              <div className="rounded-lg border border-surface-200 bg-surface-50 p-4 text-sm text-surface-700 whitespace-pre-wrap">
                {authorization.consentText}
              </div>
              <p className="text-xs text-surface-400">Consent version {authorization.consentVersion}</p>
            </CardContent>
          </Card>

          <AuthorizationAcceptanceForm authorizationId={authorization.id} backHref={dashboardHref} />
        </>
      )}
    </div>
  )
}

export default async function PortalAuthorizationPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  const currentClient = clients.find((c) => c.clientId === currentClientId)
  const dashboardHref = `/portal/dashboard?client=${currentClientId}`

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <PortalAuthorizationBody clientId={currentClientId} clientDisplayName={currentClient?.displayName ?? ""} dashboardHref={dashboardHref} />
    </PortalShell>
  )
}
