import type { ReportsData } from "@/lib/actions/reports"

export { readinessLabel } from "@/lib/utils"

function pct(part: number, total: number): number {
  return total > 0 ? Math.round((part / total) * 100) : 0
}

export interface ReportsOverviewMetrics {
  complianceScore: number
  auditReadinessPct: number
  dataCompletenessPct: number
  signatureCompletionPct: number
  approvalRatePct: number
  organizationHealthPct: number
  activeStaffCount: number
  monthlyTrend: { month: string; count: number }[]
}

/**
 * All values are computed directly from ReportsData fields already returned by
 * getReportsData — no new Prisma queries or business rules are introduced.
 * organizationHealthPct is a simple average of the other real percentages,
 * used only as a presentational rollup (see reports "Organization Health" card).
 */
export function deriveOverviewMetrics(data: ReportsData): ReportsOverviewMetrics {
  const auditReadinessPct = pct(data.documents.completed, data.documents.total)
  const dataCompletenessPct = pct(data.packets.completed, data.packets.total)
  const signatureCompletionPct = pct(data.signatures.completed, data.signatures.total)
  const approvalRatePct = pct(data.approvals.approved, data.approvals.total)
  const complianceScore = data.validations.avgScore

  const organizationHealthPct = Math.round(
    (complianceScore + auditReadinessPct + signatureCompletionPct + approvalRatePct) / 4
  )

  return {
    complianceScore,
    auditReadinessPct,
    dataCompletenessPct,
    signatureCompletionPct,
    approvalRatePct,
    organizationHealthPct,
    activeStaffCount: data.staffActivity.length,
    monthlyTrend: data.monthlyCompletion,
  }
}
