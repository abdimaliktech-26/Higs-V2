import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { FileText, CheckCircle, CircleDot, AlertCircle, AlertTriangle, Circle, Eye, Edit } from "lucide-react"
import { formatDate } from "@/lib/utils"
import { PortalShareToggle } from "./portal-share-toggle"

function docStatusIcon(status: string) {
  switch (status) {
    case "completed": return <CheckCircle className="h-5 w-5 text-success-500" />
    case "in_progress": return <CircleDot className="h-5 w-5 text-brand-500" />
    case "needs_review": return <AlertCircle className="h-5 w-5 text-warning-500" />
    case "rejected": return <AlertTriangle className="h-5 w-5 text-danger-500" />
    default: return <Circle className="h-5 w-5 text-surface-300" />
  }
}

interface DocRow {
  id: string
  status: string
  isRequired: boolean
  completedAt: Date | null
  documentTemplate: { name: string; formType: string; version: number }
  validationResults: { criticalCount: number; warningCount: number }[]
  portalVisible: boolean
  portalAccessLevel: string | null
}

export function PacketDocumentsTable({ docs, completedDocs }: { docs: DocRow[]; completedDocs: number }) {
  const required = docs.filter((d) => d.isRequired)
  const optional = docs.filter((d) => !d.isRequired)

  return (
    <Card id="documents">
      <CardHeader>
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-surface-400" />
          <CardTitle>Documents</CardTitle>
          <CardDescription>{completedDocs}/{docs.length} complete</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {docs.length === 0 ? (
          <EmptyState title="No documents" description="This packet has no required documents defined" icon={<FileText className="h-6 w-6" />} />
        ) : (
          <div className="space-y-5">
            <DocGroup title="Required" docs={required} />
            {optional.length > 0 && <DocGroup title="Optional" docs={optional} />}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function DocGroup({ title, docs }: { title: string; docs: DocRow[] }) {
  if (docs.length === 0) return null
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">{title} ({docs.length})</p>
      <div className="space-y-1">
        {docs.map((doc) => {
          const latestVr = doc.validationResults[0]
          return (
            <div key={doc.id} className="flex items-center gap-3 rounded-lg border border-surface-100 p-3 hover:bg-surface-50 transition-colors">
              <div className="shrink-0">{docStatusIcon(doc.status)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-surface-900">{doc.documentTemplate.name}</p>
                  {latestVr && latestVr.criticalCount > 0 && <Badge variant="danger" size="sm">{latestVr.criticalCount} error{latestVr.criticalCount === 1 ? "" : "s"}</Badge>}
                  {latestVr && latestVr.criticalCount === 0 && latestVr.warningCount > 0 && <Badge variant="warning" size="sm">{latestVr.warningCount} warning{latestVr.warningCount === 1 ? "" : "s"}</Badge>}
                </div>
                <p className="text-xs text-surface-500">
                  {doc.documentTemplate.formType} · v{doc.documentTemplate.version}
                  {doc.completedAt && <> · Completed {formatDate(doc.completedAt)}</>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <StatusChip status={doc.status} size="sm" />
                <PortalShareToggle documentId={doc.id} portalVisible={doc.portalVisible} portalAccessLevel={doc.portalAccessLevel} />
                <Link href={`/documents/${doc.id}/edit`}>
                  <Button variant="ghost" size="icon-sm" title={doc.status === "completed" ? "View" : "Edit"}>
                    {doc.status === "completed" ? <Eye className="h-4 w-4" /> : <Edit className="h-4 w-4" />}
                  </Button>
                </Link>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
