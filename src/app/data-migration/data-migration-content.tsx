import { getClients } from "@/lib/actions/client"
import { getPackets } from "@/lib/actions/templates"
import { getLibraryDashboardSummary } from "@/lib/actions/library"
import { getValidationResults } from "@/lib/actions/validation"
import { getAuditEvents } from "@/lib/actions/audit"
import { PlatformActivityCard } from "@/app/integrations/platform-activity"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { ReadinessHeader } from "./readiness-header"
import { CurrentDataTotalsRow } from "./current-data-totals"
import { ManualSetupActionsCard } from "./manual-setup-actions"
import { FileUploadCapabilityCard } from "./file-upload-capability"
import { ReadinessChecklistCard } from "./readiness-checklist"
import { FutureMigrationCapabilitiesGrid } from "./future-capabilities"

interface Props { orgId?: string; isSuperAdmin: boolean }

export async function DataMigrationContent({ orgId, isSuperAdmin }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <ReadinessHeader />
        <div className="rounded-xl border border-surface-200 bg-white p-16">
          <EmptyState title="Switch to an organization" description="Select an organization to view its data import readiness." icon={<Building2 className="h-8 w-8" />} />
        </div>
      </div>
    )
  }
  if (!orgId) return null

  let clientsRes: Awaited<ReturnType<typeof getClients>>
  let packetsRes: Awaited<ReturnType<typeof getPackets>>
  let librarySummary: Awaited<ReturnType<typeof getLibraryDashboardSummary>>
  let validationRes: Awaited<ReturnType<typeof getValidationResults>>
  let activity: Awaited<ReturnType<typeof getAuditEvents>>

  try {
    [clientsRes, packetsRes, librarySummary, validationRes, activity] = await Promise.all([
      getClients(orgId, { status: "active", pageSize: 1 }),
      getPackets(orgId, { pageSize: 1 }),
      getLibraryDashboardSummary(orgId),
      getValidationResults(orgId, { pageSize: 100 }),
      getAuditEvents(orgId, { pageSize: 10 }),
    ])
  } catch (e) {
    return <ErrorState title="Error loading Data Import Readiness Center" description={(e as Error).message} />
  }

  const passRatePct = validationRes.results.length > 0
    ? Math.round((validationRes.results.filter((r) => r.criticalCount === 0).length / validationRes.results.length) * 100)
    : null

  return (
    <div className="space-y-6">
      <ReadinessHeader />

      <CurrentDataTotalsRow
        clientsTotal={clientsRes.total}
        packetsTotal={packetsRes.total}
        documentsTotal={librarySummary.totalDocuments}
        passRatePct={passRatePct}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <ManualSetupActionsCard />
        <FileUploadCapabilityCard />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <PlatformActivityCard events={activity.events} />
        <ReadinessChecklistCard />
      </div>

      <FutureMigrationCapabilitiesGrid />
    </div>
  )
}
