import { getOrgSettings } from "@/lib/actions/users"
import { getAuditEvents } from "@/lib/actions/audit"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { IntegrationsOverviewCard } from "./integrations-overview"
import { IntegrationsCatalogCard } from "./integrations-catalog"
import { PlatformCapabilitiesCard } from "./platform-capabilities"
import { PlatformActivityCard } from "./platform-activity"
import { SecurityReadinessCard } from "./security-readiness"
import { FutureCapabilitiesGrid } from "./future-capabilities"

interface Props { orgId?: string; isSuperAdmin: boolean }

export async function IntegrationsContent({ orgId, isSuperAdmin }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <IntegrationsOverviewCard />
        <div className="rounded-xl border border-surface-200 bg-white p-16">
          <EmptyState title="Switch to an organization" description="Select an organization to view its integrations." icon={<Building2 className="h-8 w-8" />} />
        </div>
      </div>
    )
  }
  if (!orgId) return null

  let org: Awaited<ReturnType<typeof getOrgSettings>>
  let activity: Awaited<ReturnType<typeof getAuditEvents>>

  try {
    [org, activity] = await Promise.all([
      getOrgSettings(orgId),
      getAuditEvents(orgId, { pageSize: 10 }),
    ])
  } catch (e) {
    return <ErrorState title="Error loading Integrations" description={(e as Error).message} />
  }

  const settings = (org?.settings as Record<string, unknown>) || {}
  const mfaEnabled = Boolean(settings.mfaEnabled)
  const ssoEnabled = Boolean(settings.ssoEnabled)
  const sentryConfigured = Boolean(process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN)

  return (
    <div className="space-y-6">
      <IntegrationsOverviewCard />

      <IntegrationsCatalogCard />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlatformCapabilitiesCard sentryConfigured={sentryConfigured} />
        <SecurityReadinessCard mfaEnabled={mfaEnabled} ssoEnabled={ssoEnabled} />
      </div>

      <PlatformActivityCard events={activity.events} />

      <FutureCapabilitiesGrid />
    </div>
  )
}
