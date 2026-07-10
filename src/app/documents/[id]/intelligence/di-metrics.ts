import type { getValidationResultDetail } from "@/lib/actions/validation"

interface FieldLike { value: string | null; isRequired: boolean }

/**
 * Completeness = populated fields / total fields — the same calculation
 * already used by components/ai/copilot-panel.tsx. This is the ONLY
 * document-quality sub-metric with real backing data (PdfField.value).
 * Accuracy, Readability, and Data Quality have no ground-truth comparison
 * stored anywhere and are intentionally not computed here.
 */
export function deriveCompleteness(fields: FieldLike[]): { completedCount: number; totalCount: number; pct: number; missingRequiredCount: number } {
  const completedCount = fields.filter((f) => f.value?.trim()).length
  const totalCount = fields.length
  const missingRequiredCount = fields.filter((f) => f.isRequired && !f.value?.trim()).length
  const pct = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0
  return { completedCount, totalCount, pct, missingRequiredCount }
}

type ValidationIssueRow = NonNullable<Awaited<ReturnType<typeof getValidationResultDetail>>>["issues"][number]

export interface PartitionedIssues {
  issues: ValidationIssueRow[]
  missingInformation: ValidationIssueRow[]
  warnings: ValidationIssueRow[]
}

/**
 * Partitions real ValidationIssue rows using their existing severity and
 * validationRule.category fields — no new categorization logic invented.
 *   - Missing Information: rule.category === "required_field"
 *   - Issues Detected: severity === "critical", not a required-field issue
 *   - Warnings: severity === "warning", not a required-field issue
 */
export function partitionIssues(issues: ValidationIssueRow[]): PartitionedIssues {
  const missingInformation = issues.filter((i) => i.validationRule?.category === "required_field")
  const rest = issues.filter((i) => i.validationRule?.category !== "required_field")
  return {
    issues: rest.filter((i) => i.severity === "critical"),
    missingInformation,
    warnings: rest.filter((i) => i.severity === "warning"),
  }
}

/**
 * A factual, template-generated summary line built only from real counts
 * already computed above — not an AI-generated narrative.
 */
export function buildSummaryLine(completeness: ReturnType<typeof deriveCompleteness>, openIssueCount: number): string {
  const parts = [`${completeness.completedCount} of ${completeness.totalCount} fields completed (${completeness.pct}%)`]
  if (completeness.missingRequiredCount > 0) parts.push(`${completeness.missingRequiredCount} required field${completeness.missingRequiredCount !== 1 ? "s" : ""} missing`)
  parts.push(openIssueCount > 0 ? `${openIssueCount} open validation issue${openIssueCount !== 1 ? "s" : ""}` : "no open validation issues")
  return parts.join(" · ")
}
