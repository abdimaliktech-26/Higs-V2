import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { Search, Building2, ChevronLeft, ChevronRight } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { PlatformOrganizationRow } from "./super-admin-data"

const PAGE_SIZE = 10

export function SuperAdminOrgTable({ orgs, total, q, page }: { orgs: PlatformOrganizationRow[]; total: number; q?: string; page: number }) {
  const filtered = q
    ? orgs.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()) || o.slug.toLowerCase().includes(q.toLowerCase()))
    : orgs

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const pageItems = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Organizations ({total})</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="mb-4 flex gap-2">
          <Input name="q" defaultValue={q || ""} placeholder="Search organizations…" leftIcon={<Search className="h-4 w-4" />} className="max-w-xs" />
          <Button type="submit" size="sm" variant="secondary">Search</Button>
        </form>

        {pageItems.length === 0 ? (
          <EmptyState className="py-12" icon={<Building2 className="h-8 w-8" />} title="No organizations match" description="Try a different search." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200">
                  {["Organization", "Plan", "Status", "Users", "Clients", "Packets", "Created"].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500 last:pr-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {pageItems.map((o) => (
                  <tr key={o.id} className="hover:bg-surface-50">
                    <td className="py-3 pr-4 font-medium text-surface-900">{o.name}</td>
                    <td className="py-3 pr-4 text-surface-700 capitalize">{o.plan}</td>
                    <td className="py-3 pr-4"><StatusChip status={o.status.toLowerCase()} size="sm" /></td>
                    <td className="py-3 pr-4 text-surface-700">{o.memberCount}</td>
                    <td className="py-3 pr-4 text-surface-700">{o.clientCount}</td>
                    <td className="py-3 pr-4 text-surface-700">{o.packetCount}</td>
                    <td className="py-3 pr-4 text-xs text-surface-500 last:pr-0">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between border-t border-surface-100 pt-4">
            <p className="text-sm text-surface-500">Page {page} of {totalPages}</p>
            <div className="flex gap-2">
              <Link href={`/super-admin?page=${page - 1}${q ? `&q=${q}` : ""}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "pointer-events-none text-surface-300" : "text-surface-600 hover:bg-surface-100"}`}>
                <ChevronLeft className="h-4 w-4" /> Previous
              </Link>
              <Link href={`/super-admin?page=${page + 1}${q ? `&q=${q}` : ""}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= totalPages ? "pointer-events-none text-surface-300" : "text-surface-600 hover:bg-surface-100"}`}>
                Next <ChevronRight className="h-4 w-4" />
              </Link>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
