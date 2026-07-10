import { getPlatformOrganizations, getPlatformActivity, getPlatformAiUsage, getPlatformUserTotals } from "./super-admin-data"
import { derivePlatformKpis, deriveTenantProvisioning } from "./super-admin-metrics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState } from "@/components/ui/states"
import { Building2, Megaphone, Download, Wrench, Settings2, MoreHorizontal } from "lucide-react"
import { SuperAdminKpiRow } from "./super-admin-kpi-row"
import { SuperAdminOrgTable } from "./super-admin-org-table"
import { SuperAdminActivityTimeline } from "./super-admin-activity"
import { SuperAdminAiOperationsCard } from "./super-admin-ai-ops"
import { TenantProvisioningCard } from "./super-admin-provisioning"
import { AiPlatformAdvisorCard, SuperAdminQuickActionsCard, GenerateReportsCard } from "./super-admin-sidebar"
import { SuperAdminComingSoonGrid } from "./super-admin-coming-soon"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { q?: string; page?: number }

export async function SuperAdminContent({ q, page }: Props) {
  let orgs: Awaited<ReturnType<typeof getPlatformOrganizations>>
  let activity: Awaited<ReturnType<typeof getPlatformActivity>>
  let aiUsage: Awaited<ReturnType<typeof getPlatformAiUsage>>
  let userTotals: Awaited<ReturnType<typeof getPlatformUserTotals>>

  try {
    [orgs, activity, aiUsage, userTotals] = await Promise.all([
      getPlatformOrganizations(),
      getPlatformActivity(),
      getPlatformAiUsage(),
      getPlatformUserTotals(),
    ])
  } catch (e) {
    return <ErrorState title="Error loading platform console" description={(e as Error).message} />
  }

  const kpis = derivePlatformKpis(orgs, userTotals, aiUsage)
  const provisioning = deriveTenantProvisioning(orgs)

  return (
    <div className="space-y-6">
      <PageHeader />

      <SuperAdminKpiRow kpis={kpis} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,7fr)_minmax(0,3fr)]">
        <div className="space-y-6">
          <SuperAdminOrgTable orgs={orgs} total={orgs.length} q={q} page={page || 1} />

          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <SuperAdminAiOperationsCard usage={aiUsage} />
            <TenantProvisioningCard summary={provisioning} />
          </div>

          <SuperAdminActivityTimeline events={activity} />

          <SuperAdminComingSoonGrid />
        </div>

        <div className="space-y-6">
          <AiPlatformAdvisorCard />
          <GenerateReportsCard />
          <SuperAdminQuickActionsCard />
        </div>
      </div>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Super Admin Platform Console</h1>
          <Badge variant="success" size="sm">Live</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">Monitor, manage, and oversee the Higsi platform across all organizations.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><Building2 className="h-4 w-4" /> Create Organization</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Megaphone className="h-4 w-4" /> Broadcast Announcement</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export Platform Report</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Wrench className="h-4 w-4" /> System Maintenance</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Settings2 className="h-4 w-4" /> Platform Settings</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[{ value: "flags", label: "Feature Flags", disabled: true }]}
        />
      </div>
    </div>
  )
}
