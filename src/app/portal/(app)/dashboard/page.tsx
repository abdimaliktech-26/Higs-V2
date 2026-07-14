import Link from "next/link"
import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalDashboard, generatePortalDueDateReminders } from "@/lib/actions/portal-dashboard"
import { getPortalAccessAuthorizationForClient } from "@/lib/actions/portal-access-authorizations"
import { derivePortalAuthorizationState } from "@/lib/portal/authorization-status"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { buttonVariants } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { Building2, FolderOpen, Activity, ShieldCheck } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"

export const dynamic = "force-dynamic"

// Extracted so tests can render and assert the prompt's own visibility
// rules directly — mocking only getPortalAccessAuthorizationForClient —
// without also mocking getPortalDashboard, generatePortalDueDateReminders,
// resolvePortalPageContext, or PortalShell's next/navigation hooks. Shown
// only when there is something actually actionable: the caller's own,
// currently active grant has a pending authorization that is effective now
// and not revoked/expired/already accepted. derivePortalAuthorizationState
// is the same shared derivation the acceptance page itself uses, so the
// two surfaces can never disagree.
export async function PendingAuthorizationPrompt({ clientId }: { clientId: string }) {
  const authorization = await getPortalAccessAuthorizationForClient(clientId)
  const state = derivePortalAuthorizationState(authorization, new Date())
  if (state !== "PENDING_ACTIONABLE") return null

  return (
    <Card>
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" />
          <div>
            <p className="text-sm font-medium text-surface-900">Review signing authorization</p>
            <p className="mt-0.5 text-sm text-surface-600">You have a signing authorization that requires your review. Accepting it will not sign any document.</p>
          </div>
        </div>
        <Link href={`/portal/authorization?client=${clientId}`} className={buttonVariants({ variant: "primary", size: "sm" })}>
          Review authorization
        </Link>
      </CardContent>
    </Card>
  )
}

export default async function PortalDashboardPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  await generatePortalDueDateReminders(currentClientId)
  const dashboard = await getPortalDashboard(currentClientId)

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Welcome back</h1>
          <p className="mt-1 text-sm text-surface-500">
            {dashboard.clientDisplayName} · {dashboard.organizationName}{dashboard.program ? ` · ${dashboard.program}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-surface-400">You have {dashboard.relationship.toLowerCase()} access</p>
        </div>

        <PendingAuthorizationPrompt clientId={currentClientId} />

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-surface-400" />
              <CardTitle>Packet Progress</CardTitle>
            </div>
          </CardHeader>
          <CardContent>
            {dashboard.packet ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-surface-700 capitalize">{dashboard.packet.packetType.replace(/_/g, " ")}</p>
                  <p className="text-2xl font-bold text-brand-700">{dashboard.packet.completionPct}%</p>
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-surface-100">
                  <div className="h-full rounded-full bg-brand-600" style={{ width: `${dashboard.packet.completionPct}%` }} />
                </div>
                <p className="text-xs text-surface-500">
                  {dashboard.packet.requiredCompleted} of {dashboard.packet.requiredTotal} required documents complete
                  {dashboard.packet.dueDate && <> · Due {formatDate(dashboard.packet.dueDate)}</>}
                </p>
              </div>
            ) : (
              <EmptyState title="No active packet" description="There is no active intake packet for this client right now." icon={<FolderOpen className="h-6 w-6" />} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Activity className="h-5 w-5 text-surface-400" />
              <CardTitle>Recent Activity</CardTitle>
            </div>
            <CardDescription>Recent account activity on your portal account</CardDescription>
          </CardHeader>
          <CardContent>
            {dashboard.recentActivity.length === 0 ? (
              <EmptyState title="No recent activity" description="Nothing to show yet." icon={<Activity className="h-6 w-6" />} />
            ) : (
              <div className="space-y-2">
                {dashboard.recentActivity.map((event) => (
                  <div key={event.id} className="flex items-center justify-between rounded-lg border border-surface-100 px-3 py-2 text-sm">
                    <span className="text-surface-700">{event.description}</span>
                    <span className="text-xs text-surface-400">{formatDateTime(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
