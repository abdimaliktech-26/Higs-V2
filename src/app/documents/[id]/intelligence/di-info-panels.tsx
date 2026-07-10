import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { formatDate } from "@/lib/utils"

interface DocumentInfoProps {
  documentName: string
  documentType: string
  packetType: string
  status: string
  currentVersion: number
  addedAt: Date
}

export function DocumentInformationCard({ documentName, documentType, packetType, status, currentVersion, addedAt }: DocumentInfoProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Document Information</CardTitle>
        <StatusChip status={status} size="sm" />
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        <Row label="Document Name" value={documentName} />
        <Row label="Document Type" value={documentType} />
        <Row label="Packet Type" value={packetType.replace(/_/g, " ")} />
        <Row label="Current Version" value={`v${currentVersion}`} />
        <Row label="Added to Packet" value={formatDate(addedAt)} />
      </CardContent>
    </Card>
  )
}

interface ClientInfoProps {
  clientId: string
  clientName: string
  mcadId: string | null
  caseManagerName: string | null
}

export function ClientInformationCard({ clientId, clientName, mcadId, caseManagerName }: ClientInfoProps) {
  return (
    <Card>
      <CardHeader><CardTitle>Client Information</CardTitle></CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        <Row label="Client Name" value={clientName} />
        <Row label="Client ID" value={mcadId || "—"} />
        <Row label="Case Manager" value={caseManagerName || "—"} />
        <Link href={`/clients/${clientId}`} className="inline-block pt-1 text-sm font-medium text-brand-600 hover:underline">View Client Profile →</Link>
      </CardContent>
    </Card>
  )
}

interface PacketInfoProps {
  packetId: string
  programName: string | null
  status: string
  dueDate: Date | null
  assignedToName: string | null
}

export function PacketInformationCard({ packetId, programName, status, dueDate, assignedToName }: PacketInfoProps) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Packet Information</CardTitle>
        <StatusChip status={status} size="sm" />
      </CardHeader>
      <CardContent className="space-y-2.5 text-sm">
        <Row label="Program" value={programName || "—"} />
        <Row label="Assigned To" value={assignedToName || "—"} />
        <Row label="Due Date" value={dueDate ? formatDate(dueDate) : "—"} />
        <Link href={`/packets/${packetId}`} className="inline-block pt-1 text-sm font-medium text-brand-600 hover:underline">View Packet Overview →</Link>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-surface-500">{label}</span>
      <span className="truncate font-medium text-surface-900">{value}</span>
    </div>
  )
}
