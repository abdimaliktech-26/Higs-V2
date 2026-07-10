import Link from "next/link"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { Eye, ChevronLeft, ChevronRight, ListChecks } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"
import type { WorkItem } from "./work-queue-data"

const PAGE_SIZE = 15

const priorityVariant: Record<string, "danger" | "warning" | "secondary"> = {
  high: "danger",
  medium: "warning",
  normal: "secondary",
}

export function WorkQueueTable({ items, tab, page, focusId }: { items: WorkItem[]; tab: string; page: number; focusId?: string }) {
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pageItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <Card>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <div className="px-6 py-16">
            <EmptyState title="No work items match this filter" description="Try a different tab, or check back once new packets, signatures, approvals, or validations are created." icon={<ListChecks className="h-8 w-8" />} />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200">
                  <th className="w-8 py-3 pl-6"><input type="checkbox" disabled title="Bulk selection isn't wired up yet" className="cursor-not-allowed opacity-50" /></th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Priority</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Task</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Packet</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Program</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Assigned To</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Due Date</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">SLA</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Progress</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Dependencies</th>
                  <th className="px-2 py-3 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Last Updated</th>
                  <th className="py-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {pageItems.map((item) => (
                  <tr key={item.id} className={`transition-colors hover:bg-surface-50 ${focusId === item.id ? "bg-brand-50/60" : ""}`}>
                    <td className="py-3 pl-6"><input type="checkbox" disabled title="Bulk selection isn't wired up yet" className="cursor-not-allowed opacity-50" /></td>
                    <td className="px-2 py-3"><Badge variant={priorityVariant[item.priority]} size="sm">{item.priority}</Badge></td>
                    <td className="px-2 py-3">
                      <Link href={`/tasks?tab=${tab}&focus=${item.id}`} className="font-medium text-surface-900 hover:text-brand-700 hover:underline">{item.title}</Link>
                    </td>
                    <td className="px-2 py-3 text-surface-600">{item.clientName || "—"}</td>
                    <td className="px-2 py-3 text-xs capitalize text-surface-500">{item.packetType?.replace(/_/g, " ") || "—"}</td>
                    <td className="px-2 py-3 text-xs text-surface-400">—</td>
                    <td className="px-2 py-3 text-surface-600">{item.assignedToName || "—"}</td>
                    <td className="px-2 py-3 text-xs text-surface-500">{item.dueDate ? formatDate(item.dueDate) : "—"}</td>
                    <td className="px-2 py-3 text-xs text-surface-400">—</td>
                    <td className="px-2 py-3"><StatusChip status={item.status} size="sm" /></td>
                    <td className="px-2 py-3 text-xs text-surface-400">—</td>
                    <td className="px-2 py-3 text-xs text-surface-400">—</td>
                    <td className="px-2 py-3 text-xs text-surface-500">{formatDateTime(item.lastUpdated)}</td>
                    <td className="py-3 pr-6">
                      <Link href={item.href}><Eye className="h-4 w-4 text-surface-400 hover:text-brand-600" /></Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-surface-100 p-4">
          <p className="text-sm text-surface-500">Page {page} of {totalPages}</p>
          <div className="flex gap-2">
            <Link href={`/tasks?tab=${tab}&page=${page - 1}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "pointer-events-none text-surface-300" : "text-surface-600 hover:bg-surface-100"}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
            <Link href={`/tasks?tab=${tab}&page=${page + 1}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= totalPages ? "pointer-events-none text-surface-300" : "text-surface-600 hover:bg-surface-100"}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </Card>
  )
}
