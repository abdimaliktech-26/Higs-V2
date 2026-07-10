import { getApprovalRequests } from "@/lib/actions/approvals"
import { Card, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { CheckSquare, ChevronLeft, ChevronRight, User, Clock } from "lucide-react"
import { formatDate } from "@/lib/utils"
import Link from "next/link"

interface Props { orgId: string; status?: string; page: number }

export async function ApprovalListContent({ orgId, status, page }: Props) {
  let data: Awaited<ReturnType<typeof getApprovalRequests>>
  try {
    data = await getApprovalRequests(orgId, { status, page })
  } catch (e) {
    return <ErrorState title="Error loading approvals" description={(e as Error).message} />
  }

  const counts = { all: data.total, pending: data.requests.filter(r => r.status === "pending").length }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Approval Center</h1>
          <p className="mt-1 text-sm text-surface-500">{counts.pending} pending approval{counts.pending !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {["all", "pending", "approved", "rejected", "changes_requested", "cancelled"].map((s) => (
          <Link key={s} href={`/approvals?status=${s}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              (status || "all") === s ? "bg-brand-100 text-brand-700" : "bg-surface-100 text-surface-600 hover:bg-surface-200"
            }`}>
            {s.replace(/_/g, " ").replace(/\b\w/g, (l: string) => l.toUpperCase())}
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {data.requests.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState title={status ? "No matching approvals" : "No approval requests yet"} description="Submit packets for approval from the packet overview page" icon={<CheckSquare className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client / Packet</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Submitted By</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Approver</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                    <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Submitted</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {data.requests.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-50 transition-colors cursor-pointer" onClick={() => window.location.href = `/approvals/${r.id}`}>
                      <td className="py-3 pl-6 pr-4">
                        <span className="font-medium text-surface-900">
                          {r.packet?.client.firstName} {r.packet?.client.lastName}
                        </span>
                        <span className="text-xs text-surface-500 ml-2 capitalize">{r.packet?.packetType.replace(/_/g, " ")}</span>
                      </td>
                      <td className="py-3 pr-4 text-sm text-surface-600">{r.submittedBy.name}</td>
                      <td className="py-3 pr-4 text-sm text-surface-600">{r.approver?.name || "—"}</td>
                      <td className="py-3 pr-4"><StatusChip status={r.status} size="sm" /></td>
                      <td className="py-3 pr-6 text-xs text-surface-500">{formatDate(r.createdAt)}</td>
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
            <Link href={`/approvals?status=${status || "all"}&page=${page - 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
            <Link href={`/approvals?status=${status || "all"}&page=${page + 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= data.totalPages ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
