import Link from "next/link"
import { getClientById } from "@/lib/actions/client"
import { getClientPortalAccess, getPortalInvitations } from "@/lib/actions/portal-invitations"
import { getPortalDocumentRequests, getStaffDocumentChecklist } from "@/lib/actions/portal-document-requests"
import { ErrorState } from "@/components/ui/states"
import { ArrowLeft } from "lucide-react"
import { ClientPortalAccessManager } from "./client-portal-access-manager"
import { DocumentRequestsCard } from "./document-requests-card"

interface Props { orgId: string; clientId: string }

export async function ClientPortalAccessContent({ orgId, clientId }: Props) {
  const client = await getClientById(clientId)
  if (!client || client.organizationId !== orgId) {
    return <ErrorState title="Client not found" description="This client does not exist or you do not have access." />
  }

  let access: Awaited<ReturnType<typeof getClientPortalAccess>>
  let invitations: Awaited<ReturnType<typeof getPortalInvitations>>
  let documentRequests: Awaited<ReturnType<typeof getPortalDocumentRequests>>
  let checklist: Awaited<ReturnType<typeof getStaffDocumentChecklist>>
  try {
    ;[access, invitations, documentRequests, checklist] = await Promise.all([
      getClientPortalAccess(orgId, clientId),
      getPortalInvitations(orgId, clientId),
      getPortalDocumentRequests(orgId, clientId),
      getStaffDocumentChecklist(orgId, clientId),
    ])
  } catch (e) {
    return <ErrorState title="Error" description={(e as Error).message} />
  }

  return (
    <div className="space-y-6">
      <div>
        <Link href={`/clients/${clientId}`} className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-brand-700">
          <ArrowLeft className="h-4 w-4" /> Back to {client.firstName} {client.lastName}
        </Link>
        <h1 className="mt-2 text-2xl font-bold text-surface-900 tracking-tight">Portal Access</h1>
        <p className="mt-1 text-sm text-surface-500">Guardians and authorized representatives with client-portal access for {client.firstName} {client.lastName}.</p>
      </div>

      <ClientPortalAccessManager
        orgId={orgId}
        clientId={clientId}
        clientContacts={client.contacts as { id: string; firstName: string; lastName: string; email: string | null; relationship: string; isGuardian: boolean }[]}
        access={access}
        invitations={invitations}
      />

      <DocumentRequestsCard clientId={clientId} requests={documentRequests} checklist={checklist} />
    </div>
  )
}
