"use client"

import { SearchInput } from "@/components/ui/search-input"
import { Button } from "@/components/ui/button"
import { Download } from "lucide-react"
import { auditCategories } from "./audit-categories"
import { formatDateTime } from "@/lib/utils"

interface EventRow {
  id: string
  action: string
  createdAt: string | Date
  targetType: string | null
  targetId: string | null
  actor: { name: string | null; email: string } | null
}

interface Props {
  search?: string
  action?: string
  events: EventRow[]
}

function csvEscape(value: string | number): string {
  return `"${String(value).replace(/"/g, '""')}"`
}

export function AuditFilters({ search, action, events }: Props) {
  function exportCsv() {
    const headers = ["Timestamp", "Action", "Actor", "Target Type", "Target ID"]
    const lines = [headers.map(csvEscape).join(",")]
    for (const e of events) {
      lines.push([formatDateTime(e.createdAt), e.action, e.actor?.name || e.actor?.email || "System", e.targetType || "", e.targetId || ""].map(csvEscape).join(","))
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="flex-1">
        <form>
          <SearchInput name="search" placeholder="Search actions, targets, IDs..." defaultValue={search} />
        </form>
      </div>
      <div className="flex gap-2">
        <form>
          <input type="hidden" name="search" value={search ?? ""} />
          <select
            name="action" defaultValue={action ?? ""}
            onChange={(e) => e.currentTarget.form?.requestSubmit()}
            className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700"
          >
            <option value="">All Actions</option>
            {Object.entries(auditCategories).map(([key, cat]) => (
              <optgroup key={key} label={cat.label}>
                {cat.actions.map((a) => <option key={a} value={a}>{a.replace(/_/g, " ")}</option>)}
              </optgroup>
            ))}
          </select>
        </form>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={events.length === 0} title="Export the currently loaded page of events">
          <Download className="h-4 w-4" /> Export
        </Button>
      </div>
    </div>
  )
}
