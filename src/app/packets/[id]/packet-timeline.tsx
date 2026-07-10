import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { Clock, ArrowRight } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import { severityMap } from "@/app/audit/audit-categories"
import type { ActivityItem } from "./packet-overview-panels"

const dotColor: Record<string, string> = {
  success: "bg-success-500",
  warning: "bg-warning-500",
  danger: "bg-danger-500",
  info: "bg-brand-500",
  default: "bg-surface-300",
  secondary: "bg-surface-300",
}

export function PacketTimeline({ events, packetId }: { events: ActivityItem[]; packetId: string }) {
  return (
    <Card id="activity">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Timeline</CardTitle>
        <Link href={`/audit?targetType=packet&targetId=${packetId}`} className="inline-flex items-center gap-1 text-sm font-medium text-brand-600 hover:text-brand-700">
          View full trail <ArrowRight className="h-3 w-3" />
        </Link>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState title="No activity yet" icon={<Clock className="h-6 w-6" />} />
        ) : (
          <ol className="relative space-y-5 border-l border-surface-200 pl-5">
            {events.map((e) => (
              <li key={e.id} className="relative">
                <span className={`absolute -left-[26px] top-1 h-3 w-3 rounded-full border-2 border-white ${dotColor[severityMap[e.action] || "default"]}`} />
                <p className="text-sm text-surface-800">
                  <span className="font-medium">{e.actorName || "System"}</span>{" "}
                  <span className="text-surface-600">{e.action.toLowerCase().replace(/_/g, " ")}</span>
                </p>
                <p className="text-xs text-surface-400">{formatDateTime(e.createdAt)}</p>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
