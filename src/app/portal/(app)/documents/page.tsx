import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalDocuments } from "@/lib/actions/portal-dashboard"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { FileText, Eye, Download, Building2 } from "lucide-react"
import { formatDate } from "@/lib/utils"

export const dynamic = "force-dynamic"

export default async function PortalDocumentsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  const documents = await getPortalDocuments(currentClientId)

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Documents</h1>
          <p className="mt-1 text-sm text-surface-500">Documents your care team has shared with you</p>
        </div>

        <Card>
          <CardContent className="p-0">
            {documents.length === 0 ? (
              <div className="px-6 py-16">
                <EmptyState title="No documents shared yet" description="Your care team hasn't shared any documents with you yet." icon={<FileText className="h-8 w-8" />} />
              </div>
            ) : (
              <div className="divide-y divide-surface-100">
                {documents.map((doc) => (
                  <div key={`${doc.docType}-${doc.id}`} className="flex items-center gap-3 px-6 py-4">
                    <FileText className="h-5 w-5 shrink-0 text-surface-400" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-surface-900">{doc.title}</p>
                      <p className="text-xs text-surface-500">Updated {formatDate(doc.updatedAt)}</p>
                    </div>
                    <Badge variant="outline" size="sm">{doc.accessLevel === "VIEW_AND_DOWNLOAD" ? "View & Download" : "View only"}</Badge>
                    <a href={doc.viewUrl} target="_blank" rel="noopener noreferrer">
                      <Button variant="ghost" size="icon-sm" title="Preview"><Eye className="h-4 w-4" /></Button>
                    </a>
                    {doc.downloadUrl && (
                      <a href={doc.downloadUrl}>
                        <Button variant="ghost" size="icon-sm" title="Download"><Download className="h-4 w-4" /></Button>
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center gap-3 py-4 text-sm text-surface-500">
            <Building2 className="h-4 w-4 shrink-0" />
            Uploading documents from the portal is coming soon. Contact your care team if you need to submit something.
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
