"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { StatusChip } from "@/components/ui/status-chip"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { LayoutGrid, List, Download, Archive, ChevronLeft, ChevronRight, AlertCircle, AlertTriangle } from "lucide-react"
import { bulkArchiveClients, bulkAssignCaseManager } from "@/lib/actions/client"

export interface ClientRow {
  id: string
  name: string
  dob: string | null
  mcadId: string | null
  email: string | null
  program: string | null
  extraPrograms: number
  clientStatus: string
  packetStatus: string | null
  lastReview: { date: string; label: string } | null
  nextReview: { date: string; label: string } | null
  caseManager: string | null
  completionPct: number | null
  issues: number
  updatedAt: string
  packetCount: number
}

interface StaffOption { id: string; name: string | null; email: string; role: string }

interface Props {
  rows: ClientRow[]
  staffOptions: StaffOption[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  search?: string
  status?: string
  program?: string
  packetStatus?: string
  caseManager?: string
}

function csvEscape(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

export function ClientsView({ rows, staffOptions, page, pageSize, total, totalPages, search, status, program, packetStatus, caseManager }: Props) {
  const [view, setView] = useState<"table" | "cards">("table")
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [pending, startTransition] = useTransition()
  const [actionError, setActionError] = useState<string | null>(null)

  const allSelected = rows.length > 0 && selected.size === rows.length

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))
  }
  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function exportCsv(scope: "all" | "selected") {
    const targetRows = scope === "selected" ? rows.filter((r) => selected.has(r.id)) : rows
    const headers = ["Name", "DOB", "245D ID", "Program", "Packet Status", "Case Manager", "Completion %", "Issues", "Updated"]
    const lines = [headers.map(csvEscape).join(",")]
    for (const r of targetRows) {
      lines.push([r.name, r.dob ?? "", r.mcadId ?? "", r.program ?? "", r.packetStatus ?? "", r.caseManager ?? "", r.completionPct ?? "", r.issues, r.updatedAt].map(csvEscape).join(","))
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `clients-${scope}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  function runBulkArchive() {
    setActionError(null)
    startTransition(async () => {
      const result = await bulkArchiveClients(Array.from(selected))
      if (!result.success) setActionError(result.error)
      else setSelected(new Set())
    })
  }

  function runBulkAssign(staffUserId: string) {
    if (!staffUserId) return
    setActionError(null)
    startTransition(async () => {
      const result = await bulkAssignCaseManager(Array.from(selected), staffUserId)
      if (!result.success) setActionError(result.error)
      else setSelected(new Set())
    })
  }

  const baseParams = new URLSearchParams()
  if (search) baseParams.set("search", search)
  if (status) baseParams.set("status", status)
  if (program) baseParams.set("program", program)
  if (packetStatus) baseParams.set("packetStatus", packetStatus)
  if (caseManager) baseParams.set("caseManager", caseManager)

  function pageHref(targetPage: number, targetPageSize?: number) {
    const params = new URLSearchParams(baseParams)
    params.set("page", String(targetPage))
    if (targetPageSize) params.set("pageSize", String(targetPageSize))
    return `/clients?${params.toString()}`
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-lg border border-surface-200 bg-white p-0.5">
          <button
            onClick={() => setView("table")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === "table" ? "bg-brand-50 text-brand-700" : "text-surface-500 hover:text-surface-700"}`}
          >
            <List className="h-4 w-4" /> Table View
          </button>
          <button
            onClick={() => setView("cards")}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${view === "cards" ? "bg-brand-50 text-brand-700" : "text-surface-500 hover:text-surface-700"}`}
          >
            <LayoutGrid className="h-4 w-4" /> Cards View
          </button>
        </div>
        <Button variant="secondary" size="sm" onClick={() => exportCsv("all")}>
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-brand-200 bg-brand-50 px-4 py-3">
          <span className="text-sm font-medium text-brand-800">{selected.size} selected</span>
          <select
            disabled={pending}
            defaultValue=""
            onChange={(e) => runBulkAssign(e.target.value)}
            className="h-8 rounded-md border border-brand-300 bg-white px-2 text-xs text-surface-700"
          >
            <option value="" disabled>Assign Case Manager…</option>
            {staffOptions.map((s) => <option key={s.id} value={s.id}>{s.name || s.email}</option>)}
          </select>
          <Button variant="secondary" size="sm" disabled={pending} onClick={() => exportCsv("selected")}>
            <Download className="h-4 w-4" /> Export selected
          </Button>
          <Button variant="secondary" size="sm" disabled title="Not built yet — no program-enrollment bulk action exists">Change Program</Button>
          <Button variant="secondary" size="sm" disabled title="Not built yet — no messaging system exists">Message</Button>
          <Button variant="danger" size="sm" disabled={pending} onClick={runBulkArchive}>
            <Archive className="h-4 w-4" /> Archive
          </Button>
          <button onClick={() => setSelected(new Set())} className="ml-auto text-xs text-surface-500 hover:text-surface-700">
            Clear
          </button>
        </div>
      )}

      {actionError && (
        <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-2 text-sm text-danger-700">
          <AlertCircle className="h-4 w-4 shrink-0" /> {actionError}
        </div>
      )}

      {view === "table" ? (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="w-10 py-3 pl-6">
                      <input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all clients" className="rounded border-surface-300" />
                    </th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">245D ID</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Program</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Packet Status</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Last Review</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Next Review</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Case Manager</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Completion</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Issues</th>
                    <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Updated</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {rows.map((r) => (
                    <ClientRowLine key={r.id} row={r} selected={selected.has(r.id)} onToggle={() => toggleOne(r.id)} />
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {rows.map((r) => (
            <ClientCard key={r.id} row={r} selected={selected.has(r.id)} onToggle={() => toggleOne(r.id)} />
          ))}
        </div>
      )}

      <PaginationBar page={page} pageSize={pageSize} total={total} totalPages={totalPages} pageHref={pageHref} />
    </div>
  )
}

function ClientRowLine({ row, selected, onToggle }: { row: ClientRow; selected: boolean; onToggle: () => void }) {
  const router = useRouter()
  return (
    <tr
      className={`cursor-pointer transition-colors hover:bg-surface-50 ${selected ? "bg-brand-50/40" : ""}`}
      onClick={() => router.push(`/clients/${row.id}`)}
    >
      <td className="py-3 pl-6" onClick={(e) => e.stopPropagation()}>
        <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${row.name}`} className="rounded border-surface-300" />
      </td>
      <td className="py-3 pr-4">
        <div className="flex items-center gap-3">
          <Avatar size="sm"><AvatarFallback name={row.name} className="bg-brand-100 text-brand-700 text-xs" /></Avatar>
          <div className="min-w-0">
            <p className="font-medium text-surface-900 truncate">{row.name}</p>
            <p className="text-xs text-surface-500 truncate">{row.dob ? `DOB ${row.dob}` : row.email ?? ""}</p>
          </div>
        </div>
      </td>
      <td className="py-3 pr-4"><span className="font-mono text-xs text-surface-600">{row.mcadId || "—"}</span></td>
      <td className="py-3 pr-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-surface-600">{row.program || "—"}</span>
          {row.extraPrograms > 0 && <span className="text-[10px] text-surface-400">+{row.extraPrograms} more</span>}
        </div>
      </td>
      <td className="py-3 pr-4">{row.packetStatus ? <StatusChip status={row.packetStatus} size="sm" /> : <span className="text-xs text-surface-400">No packet</span>}</td>
      <td className="py-3 pr-4">
        {row.lastReview ? (
          <div><p className="text-xs text-surface-700">{row.lastReview.date}</p><p className="text-[10px] text-surface-400">{row.lastReview.label}</p></div>
        ) : <span className="text-xs text-surface-400">—</span>}
      </td>
      <td className="py-3 pr-4">
        {row.nextReview ? (
          <div><p className="text-xs text-surface-700">{row.nextReview.date}</p><p className="text-[10px] text-surface-400">{row.nextReview.label}</p></div>
        ) : <span className="text-xs text-surface-400">—</span>}
      </td>
      <td className="py-3 pr-4"><span className="text-xs text-surface-600">{row.caseManager || "Unassigned"}</span></td>
      <td className="py-3 pr-4 w-28">{row.completionPct !== null ? <Progress value={row.completionPct} size="sm" showValue /> : <span className="text-xs text-surface-400">—</span>}</td>
      <td className="py-3 pr-4">
        {row.issues > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-danger-600"><AlertTriangle className="h-3.5 w-3.5" />{row.issues}</span>
        ) : <span className="text-xs text-surface-400">0</span>}
      </td>
      <td className="py-3 pr-6"><span className="text-xs text-surface-500">{row.updatedAt}</span></td>
    </tr>
  )
}

function ClientCard({ row, selected, onToggle }: { row: ClientRow; selected: boolean; onToggle: () => void }) {
  return (
    <Card className={selected ? "ring-2 ring-brand-400" : ""}>
      <CardContent className="p-4">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <Avatar size="md"><AvatarFallback name={row.name} className="bg-brand-100 text-brand-700 text-sm" /></Avatar>
            <div className="min-w-0">
              <Link href={`/clients/${row.id}`} className="font-medium text-surface-900 hover:text-brand-700 truncate block">{row.name}</Link>
              <p className="text-xs text-surface-500 truncate">{row.mcadId || "—"} · {row.program || "No program"}</p>
            </div>
          </div>
          <input type="checkbox" checked={selected} onChange={onToggle} aria-label={`Select ${row.name}`} className="mt-1 rounded border-surface-300" />
        </div>

        <div className="mt-3">
          {row.packetStatus ? <StatusChip status={row.packetStatus} size="sm" /> : <Badge variant="secondary" size="sm">No active packet</Badge>}
        </div>

        {row.completionPct !== null && (
          <Progress value={row.completionPct} size="sm" showValue label="Completion" className="mt-3" />
        )}

        <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
          <div>
            <p className="text-surface-400">Next Review</p>
            <p className="text-surface-700">{row.nextReview ? row.nextReview.date : "—"}</p>
          </div>
          <div>
            <p className="text-surface-400">Case Manager</p>
            <p className="text-surface-700 truncate">{row.caseManager || "Unassigned"}</p>
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between border-t border-surface-100 pt-3 text-xs">
          <span className={row.issues > 0 ? "flex items-center gap-1 text-danger-600 font-medium" : "text-surface-400"}>
            <AlertTriangle className="h-3.5 w-3.5" /> {row.issues} issue{row.issues === 1 ? "" : "s"}
          </span>
          <span className="text-surface-400">{row.packetCount} packet{row.packetCount === 1 ? "" : "s"}</span>
        </div>
      </CardContent>
    </Card>
  )
}

function PaginationBar({ page, pageSize, total, totalPages, pageHref }: { page: number; pageSize: number; total: number; totalPages: number; pageHref: (p: number, pageSize?: number) => string }) {
  if (total === 0) return null

  const start = (page - 1) * pageSize + 1
  const end = Math.min(page * pageSize, total)

  const pageNumbers = new Set<number>([1, totalPages, page, page - 1, page - 2, page + 1, page + 2].filter((p) => p >= 1 && p <= totalPages))
  const sorted = Array.from(pageNumbers).sort((a, b) => a - b)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-sm text-surface-500">Showing {start}–{end} of {total} clients</p>
      <div className="flex items-center gap-2">
        <select
          defaultValue={String(pageSize)}
          onChange={(e) => { window.location.href = pageHref(1, Number(e.target.value)) }}
          className="h-9 rounded-lg border border-surface-300 bg-white px-2 text-xs text-surface-700"
        >
          {[20, 50, 100].map((n) => <option key={n} value={n}>{n} / page</option>)}
        </select>
        {totalPages > 1 && (
          <nav className="flex items-center gap-1">
            <Link
              href={pageHref(page - 1)}
              aria-disabled={page <= 1}
              className={`inline-flex items-center rounded-lg p-2 text-sm transition-colors ${page <= 1 ? "pointer-events-none text-surface-300" : "text-surface-600 hover:bg-surface-100"}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </Link>
            {sorted.map((p, i) => (
              <span key={p} className="flex items-center">
                {i > 0 && p - sorted[i - 1] > 1 && <span className="px-1 text-surface-300">…</span>}
                <Link
                  href={pageHref(p)}
                  className={`inline-flex h-8 w-8 items-center justify-center rounded-lg text-sm font-medium transition-colors ${p === page ? "bg-brand-600 text-white" : "text-surface-600 hover:bg-surface-100"}`}
                >
                  {p}
                </Link>
              </span>
            ))}
            <Link
              href={pageHref(page + 1)}
              aria-disabled={page >= totalPages}
              className={`inline-flex items-center rounded-lg p-2 text-sm transition-colors ${page >= totalPages ? "pointer-events-none text-surface-300" : "text-surface-600 hover:bg-surface-100"}`}
            >
              <ChevronRight className="h-4 w-4" />
            </Link>
          </nav>
        )}
      </div>
    </div>
  )
}
