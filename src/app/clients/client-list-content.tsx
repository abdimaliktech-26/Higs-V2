import { getClients, getPrograms, getAvailableStaff } from "@/lib/actions/client"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { Plus, UsersIcon, TrendingUp } from "lucide-react"
import Link from "next/link"
import { formatDate } from "@/lib/utils"
import { ClientsView, type ClientRow } from "./clients-view"
import { ClientsFilters } from "./clients-filters"

interface Props {
  orgId?: string
  isSuperAdmin: boolean
  search?: string
  status?: string
  programFilter?: string
  packetStatus?: string
  caseManager?: string
  page: number
  pageSize?: number
}

function packetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

export async function ClientsListContent({ orgId, isSuperAdmin, search, status, programFilter, packetStatus, caseManager, page, pageSize }: Props) {
  let data: Awaited<ReturnType<typeof getClients>> | null = null
  let programs: Awaited<ReturnType<typeof getPrograms>> = []
  let staff: Awaited<ReturnType<typeof getAvailableStaff>> = []
  let error: string | null = null

  if (!isSuperAdmin && orgId) {
    try {
      ;[data, programs, staff] = await Promise.all([
        getClients(orgId, { search, status: status || "active", program: programFilter, packetStatus, caseManager, page, pageSize }),
        getPrograms(orgId),
        getAvailableStaff(orgId),
      ])
    } catch (e) {
      error = e instanceof Error ? e.message : "Failed to load clients"
    }
  }

  if (isSuperAdmin) {
    return (
      <div className="space-y-6">
        <PageHeader total={0} isSuperAdmin />
        <Card>
          <CardContent className="py-16">
            <EmptyState
              title="Super Admin View"
              description="Switch to an organization context to view and manage clients"
              icon={<UsersIcon className="h-8 w-8" />}
            />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-6">
        <PageHeader total={0} />
        <Card>
          <CardContent className="py-16">
            <ErrorState title="Error loading clients" description={error} />
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!data) return null

  const hasActiveFilters = Boolean(search || packetStatus || caseManager || (status && status !== "active"))
  const now = new Date()

  const rows: ClientRow[] = data.clients.map((client) => {
    const packets = client.packets
    const primaryPacket = packets[0] ?? null

    const requiredDocs = primaryPacket?.documents.filter((d) => d.isRequired) ?? []
    const completedDocs = requiredDocs.filter((d) => d.status === "completed")
    const completionPct = requiredDocs.length ? Math.round((completedDocs.length / requiredDocs.length) * 100) : null

    const issues = packets.reduce((sum, p) => {
      const latest = p.validationResults[0]
      return sum + (latest ? latest.criticalCount + latest.warningCount : 0)
    }, 0)

    const lastReviewPacket = packets
      .filter((p) => p.completedAt)
      .sort((a, b) => b.completedAt!.getTime() - a.completedAt!.getTime())[0]
    const nextReviewPacket = packets
      .filter((p) => p.dueDate && p.dueDate >= now && !["approved", "archived"].includes(p.status))
      .sort((a, b) => a.dueDate!.getTime() - b.dueDate!.getTime())[0]

    const caseManagerAssignment =
      client.assignments.find((a) => a.role === "case_manager" && a.isPrimary) ??
      client.assignments.find((a) => a.role === "case_manager") ??
      client.assignments[0] ?? null

    return {
      id: client.id,
      name: `${client.firstName} ${client.lastName}`,
      dob: client.dateOfBirth ? formatDate(client.dateOfBirth) : null,
      mcadId: client.mcadId,
      email: client.email,
      program: client.enrollments[0]?.program.name ?? null,
      extraPrograms: Math.max(0, client.enrollments.length - 1),
      clientStatus: client.status,
      packetStatus: primaryPacket?.status ?? null,
      lastReview: lastReviewPacket ? { date: formatDate(lastReviewPacket.completedAt), label: packetTypeLabel(lastReviewPacket.packetType) } : null,
      nextReview: nextReviewPacket ? { date: formatDate(nextReviewPacket.dueDate), label: packetTypeLabel(nextReviewPacket.packetType) } : null,
      caseManager: caseManagerAssignment?.staff.name || caseManagerAssignment?.staff.email || null,
      completionPct,
      issues,
      updatedAt: formatDate(client.updatedAt),
      packetCount: client._count.packets,
    }
  })

  return (
    <div className="space-y-6">
      <PageHeader total={data.total} />

      {/* Filters */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <ClientsFilters
          programs={programs}
          staff={staff}
          search={search}
          status={status}
          program={programFilter}
          packetStatus={packetStatus}
          caseManager={caseManager}
        />
        <div className="flex gap-3">
          <Link href="/clients/new">
            <Button type="button">
              <Plus className="h-4 w-4" />
              Add Client
            </Button>
          </Link>
        </div>
      </div>

      {data.clients.length === 0 ? (
        <Card>
          <CardContent className="px-6 py-16">
            <EmptyState
              title={hasActiveFilters ? "No matching clients" : "No clients yet"}
              description={hasActiveFilters ? "Try adjusting your search or filters" : "Add your first client to begin"}
              icon={<UsersIcon className="h-8 w-8" />}
              action={!hasActiveFilters ? (
                <Link href="/clients/new"><Button><Plus className="h-4 w-4" /> Add Client</Button></Link>
              ) : undefined}
            />
          </CardContent>
        </Card>
      ) : (
        <ClientsView
          rows={rows}
          staffOptions={staff}
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          search={search}
          status={status}
          program={programFilter}
          packetStatus={packetStatus}
          caseManager={caseManager}
        />
      )}
    </div>
  )
}

function PageHeader({ total, isSuperAdmin }: { total: number; isSuperAdmin?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Clients</h1>
        <p className="mt-1 text-sm text-surface-500">
          {isSuperAdmin ? "Platform-wide client directory" : "Manage and view all clients across your organization"}
        </p>
      </div>
      {!isSuperAdmin && (
        <div className="flex items-center gap-2 text-right">
          <TrendingUp className="h-4 w-4 text-surface-300" />
          <div>
            <p className="text-xl font-bold text-surface-900 leading-tight">{total}</p>
            <p className="text-xs text-surface-400 leading-tight">Total Clients</p>
          </div>
        </div>
      )}
    </div>
  )
}
