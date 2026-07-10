import { getAuditEvents, getAuditDashboardSummary } from "@/lib/actions/audit"
import { Card, CardHeader, CardContent } from "@/components/ui/card"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Search, Shield, ChevronLeft, ChevronRight } from "lucide-react"
import Link from "next/link"
import { AuditDashboard } from "./audit-dashboard"
import { AuditFilters } from "./audit-filters"
import { AuditLogTable } from "./audit-log-table"

interface Props { orgId?: string; isSuperAdmin: boolean; action?: string; search?: string; page: number }

export async function AuditListContent({ orgId, isSuperAdmin, action, search, page }: Props) {
  if (isSuperAdmin && !orgId) {
    return (
      <div className="space-y-6">
        <PageHeader />
        <Card><CardContent className="py-16">
          <EmptyState title="Switch to an organization" description="Super admins must switch to an organization to view audit events." icon={<Shield className="h-8 w-8" />} />
        </CardContent></Card>
      </div>
    )
  }

  let data: Awaited<ReturnType<typeof getAuditEvents>>
  let summary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  try {
    [data, summary] = await Promise.all([
      getAuditEvents(orgId!, { action, search, page, pageSize: 50 }),
      getAuditDashboardSummary(orgId!),
    ])
  } catch (e) {
    return <ErrorState title="Error" description={(e as Error).message} />
  }

  return (
    <div className="space-y-6">
      <PageHeader total={data.total} />

      <AuditDashboard
        auditReadinessScore={summary.auditReadinessScore}
        totalEvents={summary.totalEvents}
        eventsLast30Days={summary.eventsLast30Days}
        recentEvents={summary.recentEvents}
        recentPhiEvents={summary.recentPhiEvents}
        packetsTotal={summary.packetsTotal}
        evidenceReadyPackets={summary.evidenceReadyPackets}
      />

      {/* Existing searchable audit event log — kept in place */}
      <Card>
        <CardHeader className="pb-3">
          <AuditFilters search={search} action={action} events={data.events} />
        </CardHeader>
        <CardContent className="p-0">
          {data.events.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState title={search || action ? "No matching events" : "No audit events yet"}
                description={search || action ? "Try adjusting filters" : "Audit events will appear as actions are performed"}
                icon={<Search className="h-8 w-8" />} />
            </div>
          ) : (
            <AuditLogTable events={data.events} />
          )}
        </CardContent>
      </Card>

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500">{data.total} event{data.total !== 1 ? "s" : ""} · Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Link href={`/audit?action=${action ?? ""}&search=${search ?? ""}&page=${page - 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
            <Link href={`/audit?action=${action ?? ""}&search=${search ?? ""}&page=${page + 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= data.totalPages ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

function PageHeader({ total }: { total?: number }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Audit Center</h1>
        <p className="mt-1 text-sm text-surface-500">{total !== undefined ? `${total} event${total !== 1 ? "s" : ""}` : "Immutable event history"}</p>
      </div>
    </div>
  )
}
