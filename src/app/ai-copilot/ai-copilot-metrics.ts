import type { getAiExtractions, getAiRecommendations } from "@/lib/actions/ai"

type Extractions = Awaited<ReturnType<typeof getAiExtractions>>["extractions"]
type Recommendations = Awaited<ReturnType<typeof getAiRecommendations>>

export interface AiCopilotKpi {
  key: string
  label: string
  value: string
  available: boolean
  trend: number[] | null
}

function isToday(date: Date): boolean {
  const d = new Date(date)
  const now = new Date()
  return d.toDateString() === now.toDateString()
}

const DAY_MS = 86400000

function last7DaysTrend(items: { createdAt: Date }[]): number[] {
  const now = Date.now()
  return Array.from({ length: 7 }, (_, i) => {
    const dayStart = now - (7 - i) * DAY_MS
    const dayEnd = now - (7 - i - 1) * DAY_MS
    return items.filter((n) => {
      const t = new Date(n.createdAt).getTime()
      return t >= dayStart && t < dayEnd
    }).length
  })
}

/**
 * Every value here is computed directly from the extractions/recommendations
 * arrays already returned by getAiExtractions / getAiRecommendations, plus the
 * auditReadinessScore already returned by getAuditDashboardSummary. No new
 * Prisma queries, AI calls, or business rules are introduced. "Time Saved"
 * has no backing metric anywhere in the app, so it is marked unavailable.
 */
export function deriveAiCopilotKpis(extractions: Extractions, extractionsTotal: number, recommendations: Recommendations, auditReadinessScore: number | null): AiCopilotKpi[] {
  const analysesToday = extractions.filter((e) => isToday(e.createdAt)).length
  const complianceRisks = recommendations.filter((r) => r.type === "compliance").length
  const inconsistencies = recommendations.filter((r) => r.type === "inconsistency").length
  const avgConfidence = extractions.length > 0
    ? Math.round((extractions.reduce((s, e) => s + e.overallConfidence, 0) / extractions.length) * 100)
    : null

  const complianceRecs = recommendations.filter((r) => r.type === "compliance")
  const inconsistencyRecs = recommendations.filter((r) => r.type === "inconsistency")

  return [
    { key: "analyses_today", label: "AI Analyses Today", value: String(analysesToday), available: true, trend: last7DaysTrend(extractions) },
    { key: "compliance_risks", label: "Compliance Risks Detected", value: String(complianceRisks), available: true, trend: last7DaysTrend(complianceRecs) },
    { key: "validation_issues", label: "Validation Issues Explained", value: String(inconsistencies), available: true, trend: last7DaysTrend(inconsistencyRecs) },
    { key: "audit_readiness", label: "Audit Readiness", value: auditReadinessScore !== null ? `${auditReadinessScore}%` : "—", available: auditReadinessScore !== null, trend: null },
    { key: "documents_reviewed", label: "Documents Reviewed", value: String(extractionsTotal), available: true, trend: last7DaysTrend(extractions) },
    { key: "ai_confidence", label: "AI Confidence", value: avgConfidence !== null ? `${avgConfidence}%` : "—", available: avgConfidence !== null, trend: null },
    { key: "time_saved", label: "Time Saved (Est.)", value: "—", available: false, trend: null },
  ]
}
