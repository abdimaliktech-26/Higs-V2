import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { Activity } from "lucide-react"
import { timeAgo } from "@/lib/utils"
import { auditCategories, severityMap } from "@/app/audit/audit-categories"
import type { PlatformActivityEvent } from "./super-admin-data"

function categoryLabel(action: string): string {
  for (const cat of Object.values(auditCategories)) {
    if (cat.actions.includes(action)) return cat.label
  }
  return "System"
}

export function SuperAdminActivityTimeline({ events }: { events: PlatformActivityEvent[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Platform Activity Timeline</CardTitle></CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState className="py-8" icon={<Activity className="h-6 w-6" />} title="No recent activity" />
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3 text-sm">
                <Badge size="sm" variant={(severityMap[e.action] as BadgeProps["variant"]) || "secondary"}>{categoryLabel(e.action)}</Badge>
                <span className="min-w-0 flex-1 truncate text-surface-700">
                  {e.action.replace(/_/g, " ").toLowerCase()}
                  {e.organizationName && <span className="text-surface-400"> · {e.organizationName}</span>}
                  {e.actorName && <span className="text-surface-400"> · {e.actorName}</span>}
                </span>
                <span className="shrink-0 text-xs text-surface-400">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
