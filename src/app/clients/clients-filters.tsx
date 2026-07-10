"use client"

import { SearchInput } from "@/components/ui/search-input"

const PACKET_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "In Progress" },
  { value: "needs_validation", label: "Needs Validation" },
  { value: "validation_failed", label: "Validation Failed" },
  { value: "awaiting_signature", label: "Awaiting Signature" },
  { value: "awaiting_approval", label: "Awaiting Approval" },
  { value: "approved", label: "Approved" },
  { value: "archived", label: "Archived" },
]

interface StaffOption { id: string; name: string | null; email: string }
interface ProgramOption { id: string; name: string }

interface Props {
  programs: ProgramOption[]
  staff: StaffOption[]
  search?: string
  status?: string
  program?: string
  packetStatus?: string
  caseManager?: string
}

export function ClientsFilters({ programs, staff, search, status, program, packetStatus, caseManager }: Props) {
  return (
    <form className="flex flex-1 flex-wrap gap-3">
      <SearchInput name="search" placeholder="Search by name, 245D ID, or email..." defaultValue={search} className="max-w-xs" />
      <select name="status" defaultValue={status ?? "active"} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700">
        <option value="active">Active</option>
        <option value="all">All Statuses</option>
        <option value="archived">Archived</option>
        <option value="inactive">Inactive</option>
      </select>
      <select name="program" defaultValue={program ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700">
        <option value="">All Programs</option>
        {programs.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select name="packetStatus" defaultValue={packetStatus ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700">
        <option value="">All Packet Status</option>
        {PACKET_STATUS_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
      <select name="caseManager" defaultValue={caseManager ?? ""} onChange={(e) => e.currentTarget.form?.requestSubmit()} className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700">
        <option value="">All Case Managers</option>
        {staff.map((s) => (
          <option key={s.id} value={s.id}>{s.name || s.email}</option>
        ))}
      </select>
    </form>
  )
}
