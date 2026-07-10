import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalSettings } from "@/lib/actions/portal-dashboard"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { ShieldCheck, Building2, Mail, Clock } from "lucide-react"
import { formatDateTime } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function PortalSettingsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  const settings = await getPortalSettings()

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Account & Security</h1>
          <p className="mt-1 text-sm text-surface-500">Your portal account information</p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mail className="h-5 w-5 text-surface-400" />
              <CardTitle>Account</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-surface-500">Email</span>
              <span className="font-medium text-surface-900">{settings.email}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-surface-500">Email verification</span>
              <Badge variant={settings.emailVerified ? "success" : "warning"} size="sm">{settings.emailVerified ? "Verified" : "Not verified"}</Badge>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-surface-500">Last sign-in</span>
              <span className="text-surface-700">{settings.lastLoginAt ? formatDateTime(settings.lastLoginAt) : "—"}</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-surface-400" />
              <CardTitle>Current Session</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {settings.currentSession ? (
              <>
                <div className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-1 text-surface-500"><Clock className="h-3.5 w-3.5" /> Signed in</span>
                  <span className="text-surface-700">{formatDateTime(settings.currentSession.signedInAt)}</span>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <span className="text-surface-500">Session expires</span>
                  <span className="text-surface-700">{formatDateTime(settings.currentSession.expiresAt)}</span>
                </div>
                <p className="text-xs text-surface-400">Use &quot;Sign out&quot; in the sidebar to end this session immediately.</p>
              </>
            ) : (
              <p className="text-sm text-surface-500">No active session information available.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="py-4 text-sm text-surface-500">
            Two-factor authentication, trusted devices, and password reset from the portal are coming soon.
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
