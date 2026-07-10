import Link from "next/link"
import { workQueueTabs } from "./work-queue-data"

export function WorkQueueTabs({ active, counts }: { active: string; counts: Record<string, number> }) {
  return (
    <div className="flex flex-wrap items-center gap-1 border-b border-surface-200 pb-2">
      {workQueueTabs.map((tab) => (
        <Link
          key={tab.id}
          href={tab.id === "mine" ? "/tasks" : `/tasks?tab=${tab.id}`}
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
