import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Progress } from "@/components/ui/progress"
import { CheckCircle2 } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import type { deriveCompleteness } from "./di-metrics"

interface LatestExtraction {
  overallConfidence: number
  processingTime: number
  createdAt: Date
  modelVersion: string
}

interface Props {
  extraction: LatestExtraction | null
  classification: string
  packetType: string
  programName: string | null
  formVersion: number
  completeness: ReturnType<typeof deriveCompleteness>
}

export function AiExtractionResultsCard({ extraction, classification, packetType, programName, formVersion, completeness }: Props) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>AI Extraction Results</CardTitle>
        {extraction && <span className="text-sm font-semibold text-surface-900">{Math.round(extraction.overallConfidence * 100)}% <span className="text-xs font-normal text-surface-500">Confidence</span></span>}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm">
          <Row label="Classification" value={classification} verified />
          <Row label="Packet Type" value={packetType.replace(/_/g, " ")} verified />
          <Row label="Program" value={programName || "—"} verified={!!programName} />
          <Row label="Form Version" value={`v${formVersion}`} verified />
          <Row label="OCR Confidence" value={extraction ? `${Math.round(extraction.overallConfidence * 100)}%` : "—"} verified={!!extraction} />
          <Row label="Model Version" value={extraction?.modelVersion || "—"} verified={!!extraction} />
          <Row label="Last Analyzed" value={extraction ? formatDateTime(extraction.createdAt) : "Not yet analyzed"} verified={!!extraction} />
          <Row label="Language Detected" value="—" verified={false} note="Not tracked yet" />
        </div>

        <div className="border-t border-surface-100 pt-4">
          <div className="mb-1 flex justify-between text-xs text-surface-500"><span>Completeness</span><span>{completeness.completedCount}/{completeness.totalCount} fields</span></div>
          <Progress value={completeness.pct} size="sm" variant={completeness.pct >= 80 ? "success" : completeness.pct >= 50 ? "warning" : "danger"} />
          <p className="mt-2 text-xs text-surface-400">Accuracy, readability, and data-quality scoring aren&apos;t tracked yet — completeness is the only real document-quality metric available today.</p>
        </div>
      </CardContent>
    </Card>
  )
}

function Row({ label, value, verified, note }: { label: string; value: string; verified: boolean; note?: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-surface-500">{label}</span>
      <span className="flex items-center gap-1.5">
        <span className={`font-medium ${verified ? "text-surface-900" : "text-surface-400"}`}>{value}</span>
        {verified ? <CheckCircle2 className="h-3.5 w-3.5 text-success-500" /> : note && <span className="text-[11px] text-surface-400">({note})</span>}
      </span>
    </div>
  )
}
