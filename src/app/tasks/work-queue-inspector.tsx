import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatusChip } from "@/components/ui/status-chip"
import { PDFViewerPlaceholder } from "@/components/ui/pdf-controls"
import { EmptyState } from "@/components/ui/states"
import { MousePointerClick, FolderOpen, User } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { WorkItem } from "./work-queue-data"
import type { getPacketById } from "@/lib/actions/templates"

type PacketDetail = Awaited<ReturnType<typeof getPacketById>>

export function WorkQueueInspector({ item, packet }: { item: WorkItem | null; packet: PacketDetail }) {
  if (!item) {
    return (
      <Card>
        <CardContent className="py-16">
          <EmptyState icon={<MousePointerClick className="h-8 w-8" />} title="Select a work item" description="Choose a row from the queue on the left to inspect its details here." />
        </CardContent>
      </Card>
    )
  }

  const requiredDocs = packet?.documents.filter((d) => d.isRequired) ?? []
  const completedDocs = requiredDocs.filter((d) => d.status === "completed")
  const progressPct = requiredDocs.length > 0 ? Math.round((completedDocs.length / requiredDocs.length) * 100) : null

  return (
    <Card>
      <CardHeader>
        <Badge variant={item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "secondary"} size="sm">{item.priority}</Badge>
        <CardTitle className="mt-2">{item.title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="flex items-center justify-between text-sm">
          <span className="text-surface-500">Status</span>
          <StatusChip status={item.status} size="sm" />
        </div>

        {packet && (
          <div className="rounded-lg border border-surface-100 p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-50 text-brand-600"><User className="h-5 w-5" /></div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-surface-900">{packet.client.firstName} {packet.client.lastName}</p>
                <p className="text-xs text-surface-400">{packet.program?.name || "No program"}</p>
              </div>
              <Link href={`/clients/${packet.client.id}`}><Button variant="ghost" size="icon-sm" title="View Client Profile"><User className="h-4 w-4" /></Button></Link>
            </div>

            {progressPct !== null && (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-surface-500"><span>Required Documents ({completedDocs.length}/{requiredDocs.length})</span><span>{progressPct}%</span></div>
                <Progress value={progressPct} size="sm" variant={progressPct >= 80 ? "success" : "warning"} />
              </div>
            )}

            <div className="mt-3 space-y-1">
              {requiredDocs.slice(0, 6).map((d) => (
                <div key={d.id} className="flex items-center justify-between text-xs">
                  <span className="text-surface-600">{d.documentTemplate.name}</span>
                  <StatusChip status={d.status} size="sm" />
                </div>
              ))}
            </div>
          </div>
        )}

        {item.dueDate && (
          <div className="flex items-center justify-between text-sm">
            <span className="text-surface-500">Due Date</span>
            <span className="font-medium text-surface-900">{formatDate(item.dueDate)}</span>
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Document Preview</p>
          <PDFViewerPlaceholder fileName={packet?.packetTemplate?.name || "Packet document"} height={240} />
        </div>

        <div className="grid grid-cols-2 gap-2">
          <Link href={item.href}><Button variant="primary" size="sm" fullWidth>Open {item.source === "signature" ? "Signature" : item.source === "approval" ? "Approval" : item.source === "validation" ? "Validation" : "Packet"}</Button></Link>
          {item.packetId ? (
            <Link href={`/packets/${item.packetId}`}><Button variant="secondary" size="sm" fullWidth><FolderOpen className="h-4 w-4" /> Open Packet</Button></Link>
          ) : (
            <Button variant="secondary" size="sm" disabled title="No linked packet"><FolderOpen className="h-4 w-4" /> Open Packet</Button>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
