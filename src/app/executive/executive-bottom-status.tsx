import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { FileBarChart } from "lucide-react"
import { readinessLabel, formatDateTime } from "@/lib/utils"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function ExecutiveBottomStatus({ auditReadinessScore, lastAuditAt }: { auditReadinessScore: number | null; lastAuditAt: Date | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-surface-200 bg-white px-5 py-3 text-sm">
      <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><FileBarChart className="h-4 w-4" /> Executive Summary</Button>
      <div className="flex flex-wrap items-center gap-6 text-xs text-surface-500">
        <span>Last Audit: <span className="font-medium text-surface-900">{lastAuditAt ? formatDateTime(lastAuditAt) : "—"}</span></span>
        <span className="flex items-center gap-1.5">Overall Readiness:
          {auditReadinessScore !== null ? (
            <Badge variant="success" size="sm">{auditReadinessScore}% {readinessLabel(auditReadinessScore)}</Badge>
          ) : (
            <span className="font-medium text-surface-400">—</span>
          )}
        </span>
        <span>Environment: <span className="font-medium text-surface-900">Production</span></span>
      </div>
    </div>
  )
}
