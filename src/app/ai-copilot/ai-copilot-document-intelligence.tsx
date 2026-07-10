import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { PDFViewerPlaceholder } from "@/components/ui/pdf-controls"
import { EmptyState } from "@/components/ui/states"
import { ScanEye } from "lucide-react"
import { formatDateTime } from "@/lib/utils"

interface ExtractedField { name: string; value: string; confidence: number; fieldType: string }

interface LatestExtraction {
  id: string
  overallConfidence: number
  processingTime: number
  createdAt: Date
  fields: unknown
  packetDocumentId: string
  packetDocument: { documentTemplate: { name: string } | null; packet: { client: { firstName: string; lastName: string } | null } | null } | null
}

export function DocumentIntelligencePanel({ extraction }: { extraction: LatestExtraction | null }) {
  if (!extraction) {
    return (
      <Card>
        <CardHeader><CardTitle>Document Intelligence</CardTitle></CardHeader>
        <CardContent>
          <EmptyState className="py-10" icon={<ScanEye className="h-6 w-6" />} title="No document extractions yet" description="Run AI analysis from the PDF Editor to see OCR confidence, classification, and extracted fields here." />
        </CardContent>
      </Card>
    )
  }

  const fields = Array.isArray(extraction.fields) ? (extraction.fields as ExtractedField[]) : []
  const client = extraction.packetDocument?.packet?.client

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Document Intelligence</CardTitle>
        <Link href={`/documents/${extraction.packetDocumentId}/edit`}><Button variant="secondary" size="sm">Open Document</Button></Link>
      </CardHeader>
      <CardContent className="space-y-4">
        <PDFViewerPlaceholder fileName={extraction.packetDocument?.documentTemplate?.name || "Document"} height={260} />

        <div className="grid grid-cols-2 gap-3 text-sm">
          <Stat label="OCR Confidence" value={`${Math.round(extraction.overallConfidence * 100)}%`} />
          <Stat label="Classification" value={extraction.packetDocument?.documentTemplate?.name || "—"} />
          <Stat label="Client" value={client ? `${client.firstName} ${client.lastName}` : "—"} />
          <Stat label="Processed" value={formatDateTime(extraction.createdAt)} />
        </div>

        <div>
          <div className="mb-1 flex justify-between text-xs text-surface-500"><span>Confidence</span><span>{Math.round(extraction.overallConfidence * 100)}%</span></div>
          <Progress value={Math.round(extraction.overallConfidence * 100)} size="sm" variant={extraction.overallConfidence >= 0.8 ? "success" : "warning"} />
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Extracted Key Fields</p>
          {fields.length === 0 ? (
            <p className="text-xs text-surface-400">No fields extracted.</p>
          ) : (
            <div className="space-y-1.5">
              {fields.slice(0, 8).map((f) => (
                <div key={f.name} className="flex items-center justify-between text-sm">
                  <span className="text-surface-500">{f.name}</span>
                  <span className="font-medium text-surface-900">{f.value || "—"}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-surface-500">{label}</p>
      <p className="mt-0.5 truncate font-semibold text-surface-900">{value}</p>
    </div>
  )
}
