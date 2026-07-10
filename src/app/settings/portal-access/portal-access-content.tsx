import { getPortalInvitations, getClientsForPortalInvite } from "@/lib/actions/portal-invitations"
import { ErrorState } from "@/components/ui/states"
import { PortalAccessManager } from "./portal-access-manager"

interface Props { orgId: string }

export async function PortalAccessContent({ orgId }: Props) {
  let invitations: Awaited<ReturnType<typeof getPortalInvitations>>
  let clients: Awaited<ReturnType<typeof getClientsForPortalInvite>>
  try {
    ;[invitations, clients] = await Promise.all([
      getPortalInvitations(orgId),
      getClientsForPortalInvite(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error" description={(e as Error).message} />
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Portal Access</h1>
        <p className="mt-1 text-sm text-surface-500">Invite clients and guardians to the client portal, and manage pending invitations.</p>
      </div>
      <PortalAccessManager orgId={orgId} invitations={invitations} clients={clients} />
    </div>
  )
}
