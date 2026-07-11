import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalDocumentRequestsForClient, getPortalUploadChecklist } from "@/lib/actions/portal-document-requests"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import { Building2, ClipboardCheck } from "lucide-react"
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

  const [requests, checklist] = await Promise.all([
    getPortalDocumentRequestsForClient(currentClientId),
    getPortalUploadChecklist(currentClientId),
  ])

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Upload Center</h1>
          <p className="mt-1 text-sm text-surface-500">Securely submit documents requested by your care team.</p>
        </div>

        <Card>
          <CardContent className="flex items-center gap-4 py-5">
            <ClipboardCheck className="h-8 w-8 shrink-0 text-brand-600" />
            <div className="flex-1">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-surface-900">Required Documents</p>
                <p className="text-sm font-semibold text-surface-700">
                  {checklist.requiredCompleted} of {checklist.requiredTotal} completed
                </p>
              </div>
              <Progress value={checklist.completionPercent} className="mt-2" />
              <p className="mt-1 text-xs text-surface-500">
                {checklist.remaining === 0
                  ? "All required documents are complete."
                  : `${checklist.remaining} required document${checklist.remaining === 1 ? "" : "s"} remaining`}
              </p>
            </div>
          </CardContent>
        </Card>

        <UploadCenterManager requests={requests} />
      </div>
    </PortalShell>
  )
}
