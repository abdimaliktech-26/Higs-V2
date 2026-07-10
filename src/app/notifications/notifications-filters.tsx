import Link from "next/link"

export interface FilterTabDef { id: string; label: string }

export const filterTabs: FilterTabDef[] = [
  { id: "all", label: "All Activity" },
  { id: "unread", label: "Unread" },
  { id: "critical", label: "Critical" },
  { id: "approvals", label: "Approvals" },
  { id: "signatures", label: "Signatures" },
  { id: "validation", label: "Validation" },
  { id: "audit", label: "Audit" },
  { id: "tasks", label: "Tasks" },
  { id: "mentions", label: "Mentions" },
  { id: "messages", label: "Messages" },
  { id: "ai", label: "AI" },
  { id: "system", label: "System" },
]

export function NotificationsFilterTabs({ active, counts }: { active: string; counts: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-surface-200 pb-2">
      {filterTabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.id === "all" ? "/notifications" : `/notifications?filter=${tab.id}`}
          className={
            active === tab.id
              ? "rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
              : "rounded-lg px-3 py-1.5 text-sm font-medium text-surface-500 hover:bg-surface-50 hover:text-surface-700"
          }
        >
          {tab.label} <span className="ml-1 text-xs text-surface-400">{counts[tab.id] ?? 0}</span>
        </Link>
      ))}
    </div>
  )
}
