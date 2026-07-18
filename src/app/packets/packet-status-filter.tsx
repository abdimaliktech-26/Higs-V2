"use client"

interface Props {
  status?: string
  search?: string
}

export function PacketStatusFilter({ status, search }: Props) {
  return (
    <form className="flex gap-2">
      <input type="hidden" name="search" value={search ?? ""} />
      <select
        name="status"
        defaultValue={status ?? "all"}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className="h-10 rounded-lg border border-surface-300 bg-white px-3 text-sm text-surface-700"
      >
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
  )
}
