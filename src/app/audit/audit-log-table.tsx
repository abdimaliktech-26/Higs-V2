"use client"

import { useRouter } from "next/navigation"
import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { severityMap, targetHref } from "./audit-categories"
import { formatDateTime, truncate } from "@/lib/utils"

interface EventRow {
  id: string
  action: string
  createdAt: string | Date
  targetType: string | null
  targetId: string | null
  metadata: unknown
  actor: { name: string | null; email: string } | null
}

export function AuditLogTable({ events }: { events: EventRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-surface-200">
            <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Timestamp</th>
            <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Action</th>
            <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Actor</th>
            <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Target</th>
            <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Details</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-surface-100">
          {events.map((event) => {
            const meta = event.metadata as Record<string, unknown> | null
            const clientName = meta?.clientName as string | undefined
            const href = targetHref(event.targetType, event.targetId)
            return <AuditLogRow key={event.id} event={event} clientName={clientName} meta={meta} href={href} />
          })}
        </tbody>
      </table>
    </div>
  )
}

function AuditLogRow({ event, clientName, meta, href }: {
  event: EventRow; clientName?: string; meta: Record<string, unknown> | null; href: string | null
}) {
  const router = useRouter()
  return (
    <tr className="hover:bg-surface-50 transition-colors cursor-pointer" onClick={() => router.push(`/audit/${event.id}`)}>
      <td className="py-3 pl-6 pr-4 whitespace-nowrap text-xs text-surface-500">{formatDateTime(event.createdAt)}</td>
      <td className="py-3 pr-4">
        <Badge variant={severityMap[event.action] || "default"} size="sm">
          {event.action.replace(/_/g, " ")}
        </Badge>
      </td>
      <td className="py-3 pr-4">
        <span className="text-xs text-surface-700">{event.actor?.name || event.actor?.email || "System"}</span>
      </td>
      <td className="py-3 pr-4">
        {href ? (
          <Link href={href} onClick={(e) => e.stopPropagation()} className="text-xs font-mono text-brand-600 hover:text-brand-700">
            {event.targetType}: {truncate(event.targetId || "", 16)}
          </Link>
        ) : (
          <div className="text-xs">
            {event.targetType && <span className="text-surface-500">{event.targetType}: </span>}
            <span className="text-surface-700 font-mono">{event.targetId ? truncate(event.targetId, 16) : "—"}</span>
          </div>
        )}
      </td>
      <td className="py-3 pr-6">
        <span className="text-xs text-surface-500">
          {clientName ? truncate(clientName, 30) : meta ? truncate(JSON.stringify(meta).replace(/["{}]/g, ""), 40) : "—"}
        </span>
      </td>
    </tr>
  )
}
