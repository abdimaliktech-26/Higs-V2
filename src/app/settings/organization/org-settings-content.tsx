import { getOrgSettings, getOrgUsers } from "@/lib/actions/users"
import { getAuditDashboardSummary, getAuditEvents } from "@/lib/actions/audit"
import { getAiRecommendations } from "@/lib/actions/ai"
import { getOrgPrograms } from "./org-settings-data"
import { deriveOrgConfigMetrics } from "./org-settings-metrics"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Building2, Save, UploadCloud, Download, History, MoreHorizontal, ListChecks } from "lucide-react"
import { OrgSettingsHeroRow } from "./org-settings-hero"
import { AiOrganizationAssistant, ExecutiveInsightsCard } from "./org-settings-sidebar"
import { OrgSettingsNav } from "./org-settings-nav"
import { OrgSettingsProfileTab } from "./org-settings-profile-tab"
import { ComingSoonTab, DepartmentsTab, LocationsTab, ProgramsTab, SecurityTab, RolesPermissionsTab } from "./org-settings-other-tabs"
import { OrgSettingsMetricRow } from "./org-settings-metric-row"
import { SecurityCenterCard } from "./org-settings-security-center"
import { ActivityTimelineCard, ConfigurationComparisonCard, QuickActionsCard } from "./org-settings-activity"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId: string; tab?: string }

export async function OrgSettingsContent({ orgId, tab }: Props) {
  let org: Awaited<ReturnType<typeof getOrgSettings>>
  let members: Awaited<ReturnType<typeof getOrgUsers>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let recentActivity: Awaited<ReturnType<typeof getAuditEvents>>
  let aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>
  let programs: Awaited<ReturnType<typeof getOrgPrograms>>

  try {
    [org, members, auditSummary, recentActivity, aiRecs, programs] = await Promise.all([
      getOrgSettings(orgId),
      getOrgUsers(orgId),
      getAuditDashboardSummary(orgId),
      getAuditEvents(orgId, { pageSize: 6 }),
      getAiRecommendations(orgId, { status: "open" }),
      getOrgPrograms(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading organization settings" description={(e as Error).message} />
  }

  if (!org) return <EmptyState title="Organization not found" icon={<Building2 className="h-8 w-8" />} />

  const settings = (org.settings as Record<string, unknown>) || {}
  const activeTab = tab || "profile"
  const metrics = deriveOrgConfigMetrics(org, members, auditSummary)
  const departments = (settings.departments as string[]) || ["Clinical", "Administration", "Compliance", "Billing", "Direct Support"]
  const locations = (settings.locations as string[]) || []

  return (
    <div className="space-y-6">
      <PageHeader />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2.7fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <OrgSettingsHeroRow
            orgName={org.name}
            orgStatus={org.status}
            plan={org.plan}
            hipaaVerified={Boolean(settings.hipaaVerified)}
            updatedAt={org.updatedAt}
            openRecommendationsCount={aiRecs.length}
            metrics={metrics}
          />

          <OrgSettingsNav active={activeTab} />

          {activeTab === "profile" && <OrgSettingsProfileTab org={org} programs={programs} />}
          {activeTab === "branding" && <ComingSoonTab title="Branding" description="Organization branding assets and templates aren't stored yet. The preview panel on the Organization Profile tab shows what this will look like." />}
          {activeTab === "locations" && <LocationsTab locations={locations} />}
          {activeTab === "departments" && <DepartmentsTab departments={departments} />}
          {activeTab === "programs" && <ProgramsTab programs={programs} />}
          {activeTab === "security" && <SecurityTab />}
          {activeTab === "authentication" && <ComingSoonTab title="Authentication" description="SSO and advanced authentication configuration aren't wired up yet." />}
          {activeTab === "roles" && <RolesPermissionsTab />}
          {activeTab === "notifications" && <ComingSoonTab title="Notifications" description="Organization-level notification preferences aren't configurable yet." />}
          {activeTab === "documents" && <ComingSoonTab title="Document Settings" description="Default document handling rules aren't configurable yet." />}
          {activeTab === "pdf" && <ComingSoonTab title="PDF Editor Defaults" description="Default PDF editor behavior isn't configurable yet." />}
          {activeTab === "more" && <ComingSoonTab title="More Settings" description="Additional configuration modules will appear here." />}

          <OrgSettingsMetricRow metrics={metrics} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SecurityCenterCard />
            <ActivityTimelineCard events={recentActivity.events} />
            <ConfigurationComparisonCard />
            <QuickActionsCard />
          </div>
        </div>

        <div className="space-y-6">
          <AiOrganizationAssistant recommendations={aiRecs} />
          <ExecutiveInsightsCard />
        </div>
      </div>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Organization Settings</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">
          Configure your organization, security, compliance, integrations, branding, and platform preferences.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/onboarding"><Button variant="secondary" size="sm"><ListChecks className="h-4 w-4" /> Organization Setup Checklist</Button></Link>
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><Save className="h-4 w-4" /> Save Changes</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><UploadCloud className="h-4 w-4" /> Publish Configuration</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export Settings</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><History className="h-4 w-4" /> Settings History</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[
            { value: "duplicate", label: "Duplicate Configuration", disabled: true },
            { value: "reset", label: "Reset to Defaults", disabled: true },
            { value: "advanced", label: "Advanced Settings", disabled: true },
          ]}
        />
      </div>
    </div>
  )
}
