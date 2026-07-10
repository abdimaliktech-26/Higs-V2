import type { getValidationRules, getValidationResults } from "@/lib/actions/validation"

type RuleRow = Awaited<ReturnType<typeof getValidationRules>>[number]
type ResultRow = Awaited<ReturnType<typeof getValidationResults>>["results"][number]

export interface RulesKpis {
  activeRulesCount: number
  passRatePct: number | null
  failedValidationsToday: number
}

function isToday(date: Date): boolean {
  return new Date(date).toDateString() === new Date().toDateString()
}

/**
 * Every value here is computed from rows already returned by
 * getValidationRules / getValidationResults — no new Prisma queries,
 * no execution telemetry, no fabricated counts.
 */
export function deriveRulesKpis(rules: RuleRow[], results: ResultRow[]): RulesKpis {
  const activeRulesCount = rules.filter((r) => r.active).length
  const passRatePct = results.length > 0
    ? Math.round((results.filter((r) => r.criticalCount === 0).length / results.length) * 100)
    : null
  const failedValidationsToday = results.filter((r) => r.criticalCount > 0 && isToday(r.ranAt)).length

  return { activeRulesCount, passRatePct, failedValidationsToday }
}

export interface RuleTypeSlice {
  category: string
  count: number
}

export function deriveRuleTypeDistribution(rules: RuleRow[]): RuleTypeSlice[] {
  const counts = new Map<string, number>()
  for (const r of rules) counts.set(r.category, (counts.get(r.category) ?? 0) + 1)
  return Array.from(counts.entries())
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count)
}

export function distinctValues(rules: RuleRow[], key: "category" | "program" | "packetType"): string[] {
  const set = new Set<string>()
  for (const r of rules) {
    const v = r[key]
    if (v) set.add(v)
  }
  return Array.from(set).sort()
}
