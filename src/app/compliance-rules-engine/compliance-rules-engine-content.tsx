import { getValidationRules, getValidationResults } from "@/lib/actions/validation"
import { getAuditDashboardSummary } from "@/lib/actions/audit"
import { deriveRulesKpis, deriveRuleTypeDistribution } from "./rules-metrics"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { RulesKpiRow } from "./rules-kpi-row"
import { RuleTypeDistributionCard } from "./rule-type-distribution"
import { RulesLibraryCard } from "./rules-library-list"
import { RuleDetailPanel } from "./rule-detail-panel"
import { RecentValidationOutcomesCard } from "./recent-validation-outcomes"
import { FutureCapabilitiesGrid } from "./future-capabilities"

interface Props {
  orgId?: string
  isSuperAdmin: boolean
  category?: string
  severity?: string
  program?: string
  packetType?: string
  active?: string
  rule?: string
}

export async function ComplianceRulesEngineContent({ orgId, isSuperAdmin, category, severity, program, packetType, active, rule }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <div className="rounded-xl border border-surface-200 bg-white p-16">
          <EmptyState title="Switch to an organization" description="Select an organization to view its Compliance Rules Engine." icon={<Building2 className="h-8 w-8" />} />
        </div>
      </div>
    )
  }
  if (!orgId) return null

  let allRules: Awaited<ReturnType<typeof getValidationRules>>
  let validationRes: Awaited<ReturnType<typeof getValidationResults>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>

  try {
    [allRules, validationRes, auditSummary] = await Promise.all([
      getValidationRules(orgId, { category: category || undefined }),
      getValidationResults(orgId, { pageSize: 100 }),
      getAuditDashboardSummary(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading Compliance Rules Engine" description={(e as Error).message} />
  }

  let filtered = allRules
  if (severity) filtered = filtered.filter((r) => r.severity === severity)
  if (program) filtered = filtered.filter((r) => r.program === program)
  if (packetType) filtered = filtered.filter((r) => r.packetType === packetType)
  if (active) filtered = filtered.filter((r) => r.active === (active === "true"))

  const kpis = deriveRulesKpis(allRules, validationRes.results)
  const distribution = deriveRuleTypeDistribution(allRules)
  const selectedRule = rule ? allRules.find((r) => r.id === rule) || null : null

  return (
    <div className="space-y-6">
      <PageHeader />

      <RulesKpiRow kpis={kpis} auditReadinessScore={auditSummary.auditReadinessScore} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,3.4fr)_minmax(0,1.6fr)]">
        <div className="space-y-6">
          <RulesLibraryCard allRules={allRules} filtered={filtered} filters={{ category, severity, program, packetType, active }} selectedRuleId={rule} />
          <RecentValidationOutcomesCard results={validationRes.results} />
        </div>
        <div className="space-y-6">
          <RuleTypeDistributionCard slices={distribution} />
          <RuleDetailPanel rule={selectedRule} />
        </div>
      </div>

      <FutureCapabilitiesGrid />
    </div>
  )
}

function PageHeader() {
  return (
    <div>
      <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Compliance Rules Engine</h1>
      <p className="mt-1 max-w-2xl text-sm text-surface-500">Create and manage the organizational compliance rules that power validation across Higsi.</p>
    </div>
  )
}
