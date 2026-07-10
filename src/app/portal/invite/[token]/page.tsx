import { Lock } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { getPortalInvitationByToken } from "@/lib/actions/portal-invitations"
import { ActivateForm } from "./activate-form"

export const dynamic = "force-dynamic"

function PortalShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col bg-navy-900">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex w-full max-w-[480px] flex-col items-center">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-lg">
              <span className="text-2xl font-bold text-brand-700">H</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Higsi</h1>
              <p className="text-sm text-navy-300">Client Portal</p>
            </div>
          </div>
          {children}
          <div className="mt-8 flex items-center gap-2 text-xs text-navy-400">
            <Lock className="h-3 w-3" />
            HIPAA-compliant & secure access
          </div>
        </div>
      </div>
    </div>
  )
}

const stateMessages: Record<string, { title: string; description: string }> = {
  NOT_FOUND: { title: "Invitation not found", description: "This invitation link is invalid. Please check the link or contact your care provider for a new one." },
  EXPIRED: { title: "Invitation expired", description: "This invitation link has expired. Please contact your care provider for a new invitation." },
  REVOKED: { title: "Invitation revoked", description: "This invitation has been revoked. Please contact your care provider if you believe this is a mistake." },
  ACCEPTED: { title: "Invitation already used", description: "This invitation has already been accepted. If you already have an account, please contact your care provider for help signing in." },
}

export default async function PortalInvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params
  const invitation = await getPortalInvitationByToken(token)

  if (invitation.status !== "VALID") {
    const message = stateMessages[invitation.status] || stateMessages.NOT_FOUND
    return (
      <PortalShell>
        <Card className="w-full">
          <CardHeader>
            <CardTitle>{message.title}</CardTitle>
            <CardDescription>{message.description}</CardDescription>
          </CardHeader>
        </Card>
      </PortalShell>
    )
  }

  return (
    <PortalShell>
      <Card className="w-full">
        <CardHeader>
          <CardTitle>You&apos;re invited to the {invitation.organizationName} client portal</CardTitle>
          <CardDescription>
            Invitation for {invitation.clientDisplayName} — {invitation.relationship || invitation.accessRole.replace(/_/g, " ").toLowerCase()}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ActivateForm token={token} invitedEmail={invitation.invitedEmail} isExistingPortalUser={invitation.isExistingPortalUser} />
        </CardContent>
      </Card>
    </PortalShell>
  )
}
