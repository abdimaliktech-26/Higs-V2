import { getPackets } from "@/lib/actions/templates"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { SearchInput } from "@/components/ui/search-input"
import { Plus, FolderOpen, ChevronLeft, ChevronRight, FileText, User } from "lucide-react"
import { formatDate } from "@/lib/utils"
import Link from "next/link"

interface Props {
  orgId: string; search?: string; status?: string; page: number
}

export async function PacketListContent({ orgId, search, status, page }: Props) {
  let data: Awaited<ReturnType<typeof getPackets>>
  try {
    data = await getPackets(orgId, { search, status, page })
  } catch (e) {
    return <ErrorState title="Error loading packets" description={(e as Error).message} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Packets</h1>
          <p className="mt-1 text-sm text-surface-500">{data.total} packet{data.total === 1 ? "" : "s"} across all clients</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <form>
            <input type="hidden" name="status" value={status ?? "all"} />
            <SearchInput name="search" placeholder="Search by client name or packet type..." defaultValue={search} />
          </form>
        </div>
        <form className="flex gap-2">
          <input type="hidden" name="search" value={search ?? ""} />
          <select name="status" defaultValue={status ?? "all"} onChange={e => e.target.form?.submit()}
            className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700">
            <option value="all">All Statuses</option>
            <option value="draft">Draft</option>
            <option value="in_progress">In Progress</option>
            <option value="needs_validation">Needs Validation</option>
            <option value="validation_failed">Validation Failed</option>
            <option value="awaiting_signature">Awaiting Signature</option>
            <option value="awaiting_approval">Awaiting Approval</option>
            <option value="approved">Approved</option>
            <option value="archived">Archived</option>
          </select>
        </form>
      </div>

      <Card>
        <CardContent className="p-0">
          {data.packets.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState
                title={search || (status && status !== "all") ? "No matching packets" : "No packets yet"}
                description={search ? "Try adjusting your search" : "Create a packet from a client's profile to begin"}
                icon={<FolderOpen className="h-8 w-8" />}
              />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Packet Type</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Assigned To</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Due Date</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Docs</th>
                    <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {data.packets.map((pkt) => (
                    <tr key={pkt.id} className="hover:bg-surface-50 transition-colors cursor-pointer" onClick={() => window.location.href = `/packets/${pkt.id}`}>
                      <td className="py-3 pl-6 pr-4">
                        <div className="flex items-center gap-3">
                          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-sm font-medium text-brand-700 shrink-0">
                            {pkt.client.firstName[0]}{pkt.client.lastName[0]}
                          </div>
                          <span className="font-medium text-surface-900">{pkt.client.firstName} {pkt.client.lastName}</span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-surface-700 capitalize">{pkt.packetType.replace(/_/g, " ")}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-surface-500">{pkt.assignedTo?.name || "Unassigned"}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-surface-500">{pkt.dueDate ? formatDate(pkt.dueDate) : "—"}</span>
                      </td>
                      <td className="py-3 pr-4">
                        <span className="text-xs text-surface-500">{pkt._count.documents} docs</span>
                      </td>
                      <td className="py-3 pr-6">
                        <StatusChip status={pkt.status} size="sm" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Link href={`/packets?search=${search ?? ""}&status=${status ?? "all"}&page=${page - 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
            <Link href={`/packets?search=${search ?? ""}&status=${status ?? "all"}&page=${page + 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= data.totalPages ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
