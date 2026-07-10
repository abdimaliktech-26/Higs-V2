import { Building2, ShieldCheck } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { StatusChip } from "@/components/ui/status-chip"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkline, RadialGauge } from "@/components/ui/charts"
import { readinessLabel, formatDate } from "@/lib/utils"
import type { OrgConfigMetrics } from "./org-settings-metrics"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface HeroRowProps {
  orgName: string
  orgStatus: string
  plan: string
  hipaaVerified: boolean
  updatedAt: Date
  openRecommendationsCount: number
  metrics: OrgConfigMetrics
}

export function OrgSettingsHeroRow({ orgName, orgStatus, plan, hipaaVerified, updatedAt, openRecommendationsCount, metrics }: HeroRowProps) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
      <ConfigurationHealthCard updatedAt={updatedAt} openRecommendationsCount={openRecommendationsCount} metrics={metrics} />
      <OrganizationOverviewCard orgName={orgName} orgStatus={orgStatus} plan={plan} hipaaVerified={hipaaVerified} metrics={metrics} />
      <ConfigurationTrendCard metrics={metrics} />
    </div>
  )
}

function ConfigurationHealthCard({ updatedAt, openRecommendationsCount, metrics }: { updatedAt: Date; openRecommendationsCount: number; metrics: OrgConfigMetrics }) {
  return (
    <Card className="border-navy-800 bg-navy-900 text-white shadow-md">
      <CardContent className="p-6">
        <h2 className="text-base font-semibold text-white">Configuration Health</h2>

        <div className="mt-4 flex flex-col items-center gap-2">
          <RadialGauge value={metrics.configurationCompletionPct} progressClassName="stroke-success-400">
            <span className="text-3xl font-bold">{metrics.configurationCompletionPct}%</span>
            <span className="text-[11px] text-navy-100">Configuration Completion</span>
          </RadialGauge>
          <Badge variant="success">{readinessLabel(metrics.configurationCompletionPct)}</Badge>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <HeroStat label="Recommended Improvements" value={openRecommendationsCount} />
          <HeroStat label="Security Warnings" value="—" />
          <HeroStat label="Compliance Warnings" value="—" />
          <HeroStat label="Configuration Version" value="—" />
          <HeroStat label="Last Review" value={formatDate(updatedAt)} />
          <HeroStat label="Last Published" value="—" />
        </div>

        <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED} className="mt-5">Health Details</Button>
      </CardContent>
    </Card>
  )
}

function HeroStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-navy-200">{label}</p>
      <p className="mt-0.5 text-lg font-bold text-white">{value}</p>
    </div>
  )
}

function OrganizationOverviewCard({ orgName, orgStatus, plan, hipaaVerified, metrics }: { orgName: string; orgStatus: string; plan: string; hipaaVerified: boolean; metrics: OrgConfigMetrics }) {
  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-base font-semibold text-surface-900">Organization Overview</h2>

        <div className="mt-4 flex items-center gap-3">
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Building2 className="h-7 w-7" />
          </div>
          <div className="min-w-0">
            <p className="truncate text-base font-semibold text-surface-900">{orgName}</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              <StatusChip status={orgStatus.toLowerCase()} size="sm" />
              {hipaaVerified ? (
                <Badge variant="success" size="sm"><ShieldCheck className="mr-1 h-3 w-3" /> HIPAA Verified</Badge>
              ) : (
                <Badge variant="secondary" size="sm">Not HIPAA Verified</Badge>
              )}
            </div>
          </div>
        </div>

        <div className="mt-5 grid grid-cols-2 gap-4 text-sm">
          <OverviewStat label="Subscription" value={plan} />
          <OverviewStat label="Licensed Users" value={metrics.licensedUsersCount} />
          <OverviewStat label="License Utilization" value="—" />
          <OverviewStat label="Storage Usage" value="—" />
          <OverviewStat label="Compliance Health" value={`${metrics.configurationCompletionPct}%`} />
          <OverviewStat label="Security Score" value="—" />
          <OverviewStat label="Organization Readiness" value={readinessLabel(metrics.configurationCompletionPct)} />
        </div>
      </CardContent>
    </Card>
  )
}

function OverviewStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <p className="text-xs text-surface-500">{label}</p>
      <p className="mt-0.5 font-semibold text-surface-900">{value}</p>
    </div>
  )
}

function ConfigurationTrendCard({ metrics }: { metrics: OrgConfigMetrics }) {
  const points = metrics.activityTrend.map((b) => b.count)
  const labels = metrics.activityTrend.map((b) => b.label)

  return (
    <Card>
      <CardContent className="p-6">
        <h2 className="text-base font-semibold text-surface-900">Configuration Trend</h2>
        <p className="text-xs text-surface-400">Audit activity, last {metrics.activityTrend.length} weeks</p>
        <Sparkline points={points} labels={labels} height={130} className="mt-3" />

        <div className="mt-4 rounded-lg border border-surface-100 p-3">
          <p className="text-xs text-surface-500">Active Staff</p>
          <p className="mt-0.5 text-xl font-bold text-surface-900">{metrics.activeUsersCount}</p>
        </div>
      </CardContent>
    </Card>
  )
}
