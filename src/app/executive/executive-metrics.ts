import type { getValidationResults } from "@/lib/actions/validation"
import type { getSignatureRequests } from "@/lib/actions/signatures"
import type { getPackets } from "@/lib/actions/templates"

type ValidationRow = Awaited<ReturnType<typeof getValidationResults>>["results"][number]
type SignatureRow = Awaited<ReturnType<typeof getSignatureRequests>>["requests"][number]
type PacketRow = Awaited<ReturnType<typeof getPackets>>["packets"][number]

/**
 * Presentational metric definitions (not pre-existing named KPIs elsewhere
 * in the app) — documented per the approved plan:
 *   - Compliance Pass Rate = % of ValidationResult rows with criticalCount === 0
 *   - Health tiers = buckets of ValidationResult.score (0-100)
 * Both are computed only from rows already returned by getValidationResults —
 * no new Prisma queries, no invented scoring.
 */

export interface ComplianceKpis {
  passRatePct: number | null
  clientsServed: number
}

export function deriveComplianceKpis(results: ValidationRow[], clientsServed: number): ComplianceKpis {
  const passRatePct = results.length > 0
    ? Math.round((results.filter((r) => r.criticalCount === 0).length / results.length) * 100)
    : null
  return { passRatePct, clientsServed }
}

const WEEK_MS = 7 * 86400000

export interface TrendPoint { label: string; passRatePct: number }

export function deriveComplianceTrend(results: ValidationRow[], weeks = 12): TrendPoint[] {
  const now = Date.now()
  const buckets = Array.from({ length: weeks }, (_, i) => ({
    label: `W${weeks - i}`,
    start: now - (weeks - i) * WEEK_MS,
    end: now - (weeks - i - 1) * WEEK_MS,
    items: [] as ValidationRow[],
  }))

  for (const r of results) {
    const t = new Date(r.ranAt).getTime()
    const bucket = buckets.find((b) => t >= b.start && t < b.end)
    if (bucket) bucket.items.push(r)
  }

  return buckets.map((b) => ({
    label: b.label,
    passRatePct: b.items.length > 0 ? Math.round((b.items.filter((r) => r.criticalCount === 0).length / b.items.length) * 100) : 0,
  }))
}

export type HealthTier = "excellent" | "good" | "needs_attention" | "at_risk"

function tierFor(score: number): HealthTier {
  if (score >= 90) return "excellent"
  if (score >= 75) return "good"
  if (score >= 50) return "needs_attention"
  return "at_risk"
}

export interface HealthTierBreakdown { tier: HealthTier; label: string; pct: number }

export function deriveHealthTierBreakdown(results: ValidationRow[]): HealthTierBreakdown[] {
  const tiers: { tier: HealthTier; label: string }[] = [
    { tier: "excellent", label: "Excellent" },
    { tier: "good", label: "Good" },
    { tier: "needs_attention", label: "Needs Attention" },
    { tier: "at_risk", label: "At Risk" },
  ]
  const total = results.length
  return tiers.map(({ tier, label }) => ({
    tier,
    label,
    pct: total > 0 ? Math.round((results.filter((r) => tierFor(r.score) === tier).length / total) * 100) : 0,
  }))
}

export interface StrategicRisk {
  label: string
  detail: string
  severity: "high" | "medium" | "low"
  available: boolean
}

const TERMINAL_SIGNATURE_STATUSES = ["signed", "declined", "cancelled"]

export function deriveStrategicRisks(signatures: SignatureRow[], packets: PacketRow[], results: ValidationRow[]): StrategicRisk[] {
  const missingSignatures = signatures.filter((s) => !TERMINAL_SIGNATURE_STATUSES.includes(s.status))
  const overdueAnnualReviews = packets.filter((p) => p.packetType === "annual_review" && p.dueDate && new Date(p.dueDate) < new Date() && !["approved", "archived"].includes(p.status))
  const criticalValidations = results.filter((r) => r.criticalCount > 0)

  return [
    { label: "Missing Signatures", detail: `${missingSignatures.length} packet${missingSignatures.length !== 1 ? "s" : ""}`, severity: "high", available: true },
    { label: "Overdue Annual Reviews", detail: `${overdueAnnualReviews.length} client${overdueAnnualReviews.length !== 1 ? "s" : ""}`, severity: "high", available: true },
    { label: "Critical Validation Issues", detail: `${criticalValidations.length} packet${criticalValidations.length !== 1 ? "s" : ""}`, severity: "medium", available: true },
    { label: "Staff Certifications Expiring", detail: "—", severity: "medium", available: false },
    { label: "Service Authorization Nearing Expiration", detail: "—", severity: "low", available: false },
  ]
}

export interface LeadershipFocusItem { message: string }

export function deriveLeadershipFocus(recommendationMessages: string[], risks: StrategicRisk[]): LeadershipFocusItem[] {
  const items: LeadershipFocusItem[] = []
  for (const r of risks) {
    if (r.available && !r.detail.startsWith("0")) items.push({ message: `Address ${r.label.toLowerCase()} (${r.detail})` })
  }
  for (const m of recommendationMessages) items.push({ message: m })
  return items.slice(0, 4)
}
