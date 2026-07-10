import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalDocumentRequestsForClient } from "@/lib/actions/portal-document-requests"
import { PortalShell } from "@/app/portal/portal-shell"
import { EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { UploadCenterManager } from "./upload-center-manager"

export const dynamic = "force-dynamic"

export default async function PortalUploadPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  const requests = await getPortalDocumentRequestsForClient(currentClientId)

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Upload Center</h1>
          <p className="mt-1 text-sm text-surface-500">Securely submit documents requested by your care team.</p>
        </div>
        <UploadCenterManager requests={requests} />
      </div>
    </PortalShell>
  )
}
