import { getOrgSettings, getOrgUsers } from "@/lib/actions/users"
import { getOrgPrograms } from "@/app/settings/organization/org-settings-data"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { SetupOverviewHeader } from "./setup-overview"
import {
  OrganizationInformationItem, LocationsItem, DepartmentsItem, ProgramsItem, StaffSetupItem,
  SecuritySetupItem, DocumentSetupItem, SignatureWorkflowItem, ComplianceRulesItem, IntegrationsItem,
} from "./setup-sections"
import { FutureSetupCapabilitiesGrid } from "./future-setup-capabilities"

interface Props { orgId?: string; isSuperAdmin: boolean }

export async function OnboardingContent({ orgId, isSuperAdmin }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <SetupOverviewHeader />
        <div className="rounded-xl border border-surface-200 bg-white p-16">
          <EmptyState title="Switch to an organization" description="Select an organization to view its setup checklist." icon={<Building2 className="h-8 w-8" />} />
        </div>
      </div>
    )
  }
  if (!orgId) return null

  let org: Awaited<ReturnType<typeof getOrgSettings>>
  let members: Awaited<ReturnType<typeof getOrgUsers>>
  let programs: Awaited<ReturnType<typeof getOrgPrograms>>

  try {
    [org, members, programs] = await Promise.all([
      getOrgSettings(orgId),
      getOrgUsers(orgId),
      getOrgPrograms(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading Organization Setup" description={(e as Error).message} />
  }

  if (!org) return <EmptyState title="Organization not found" icon={<Building2 className="h-8 w-8" />} />

  const settings = (org.settings as Record<string, unknown>) || {}
  const locations = (settings.locations as string[]) || []
  const departments = (settings.departments as string[]) || []
  const defaultPacketType = (settings.defaultPacketType as string) || null
  const mfaEnabled = Boolean(settings.mfaEnabled)
  const ssoEnabled = Boolean(settings.ssoEnabled)

  return (
    <div className="space-y-6">
      <SetupOverviewHeader />

      <div className="space-y-4">
        <OrganizationInformationItem name={org.name} timezone={(settings.timezone as string) || null} />
        <LocationsItem locations={locations} />
        <DepartmentsItem departments={departments} />
        <ProgramsItem programNames={programs.map((p) => p.name)} />
        <StaffSetupItem memberCount={members.length} />
        <SecuritySetupItem mfaEnabled={mfaEnabled} ssoEnabled={ssoEnabled} />
        <DocumentSetupItem defaultPacketType={defaultPacketType} />
        <SignatureWorkflowItem />
        <ComplianceRulesItem />
        <IntegrationsItem />
      </div>

      <FutureSetupCapabilitiesGrid />
    </div>
  )
}
