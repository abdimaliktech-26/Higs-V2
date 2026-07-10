import { getSignatureRequests } from "@/lib/actions/signatures"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Badge } from "@/components/ui/badge"
import { PenSquare, ChevronLeft, ChevronRight, User, Mail, FileText, Clock } from "lucide-react"
import { formatDate } from "@/lib/utils"
import Link from "next/link"

interface Props { orgId: string; status?: string; page: number }

export async function SignatureListContent({ orgId, status, page }: Props) {
  let data: Awaited<ReturnType<typeof getSignatureRequests>>
  try {
    data = await getSignatureRequests(orgId, { status, page })
  } catch (e) {
    return <ErrorState title="Error loading signatures" description={(e as Error).message} />
  }

  const statCounts = {
    all: data.total, pending: data.requests.filter(r => r.status === "pending").length,
    sent: data.requests.filter(r => r.status === "sent").length,
    signed: data.requests.filter(r => r.status === "signed").length,
    declined: data.requests.filter(r => r.status === "declined").length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Signature Workflow</h1>
          <p className="mt-1 text-sm text-surface-500">{data.total} signature request{data.total !== 1 ? "s" : ""}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {["all", "pending", "sent", "signed", "declined"].map((s) => (
          <Link key={s} href={`/signatures?status=${s}`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
              (status || "all") === s ? "bg-brand-100 text-brand-700" : "bg-surface-100 text-surface-600 hover:bg-surface-200"
            }`}>
            {s.charAt(0).toUpperCase() + s.slice(1)} ({statCounts[s as keyof typeof statCounts]})
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-0">
          {data.requests.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState title="No signature requests" description="Request signatures from a packet overview page" icon={<PenSquare className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Signer</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client/Packet</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Role</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Due</th>
                    <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Requested By</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {data.requests.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-50 transition-colors cursor-pointer" onClick={() => window.location.href = `/signatures/${r.id}`}>
                      <td className="py-3 pl-6 pr-4">
                        <div>
                          <p className="font-medium text-surface-900">{r.signerName}</p>
                          <p className="text-xs text-surface-500">{r.signerEmail}</p>
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-surface-600">
                        {r.packet ? `${r.packet.client.firstName} ${r.packet.client.lastName} · ${r.packet.packetType.replace(/_/g, " ")}` : "—"}
                      </td>
                      <td className="py-3 pr-4"><Badge variant="secondary" size="sm">{r.signerRole}</Badge></td>
                      <td className="py-3 pr-4"><StatusChip status={r.status} size="sm" /></td>
                      <td className="py-3 pr-4 text-xs text-surface-500">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                      <td className="py-3 pr-6 text-xs text-surface-500">{r.requestedBy.name}</td>
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
            <Link href={`/signatures?status=${status || "all"}&page=${page - 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
            <Link href={`/signatures?status=${status || "all"}&page=${page + 1}`}
              className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= data.totalPages ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
