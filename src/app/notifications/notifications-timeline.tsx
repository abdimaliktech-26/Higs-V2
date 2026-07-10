import Link from "next/link"
import { markNotificationRead, dismissNotification, generateNotifications } from "@/lib/actions/notifications"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import {
  Bell, AlertTriangle, Clock, PenSquare, CheckSquare, Info, Shield, Eye, CheckCircle2, X, RefreshCw,
} from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"

type NotificationRow = {
  id: string; type: string; title: string; message: string
  link: string | null; createdAt: Date; readAt: Date | null; dismissedAt: Date | null
}

const typeConfig: Record<string, { label: string; icon: typeof Bell; color: string; severity: "danger" | "warning" | "info" | "secondary" }> = {
  overdue: { label: "Overdue", icon: Clock, color: "text-danger-600 bg-danger-50", severity: "danger" },
  validation_failure: { label: "Validation", icon: AlertTriangle, color: "text-danger-600 bg-danger-50", severity: "danger" },
  pending_signature: { label: "Signature", icon: PenSquare, color: "text-warning-600 bg-warning-50", severity: "warning" },
  pending_approval: { label: "Approval", icon: CheckSquare, color: "text-warning-600 bg-warning-50", severity: "warning" },
  system: { label: "System", icon: Shield, color: "text-brand-600 bg-brand-50", severity: "info" },
  info: { label: "Info", icon: Info, color: "text-sky-600 bg-sky-50", severity: "secondary" },
}

function groupLabel(date: Date): string {
  const now = new Date()
  const d = new Date(date)
  const isSameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString()
  const yesterday = new Date(now.getTime() - 86400000)
  if (isSameDay(d, now)) return "Today"
  if (isSameDay(d, yesterday)) return `Yesterday · ${formatDate(d)}`
  return formatDate(d)
}

export function NotificationsTimeline({ notifications, focusId }: { notifications: NotificationRow[]; focusId?: string }) {
  if (notifications.length === 0) {
    return (
      <Card>
        <CardContent className="py-16">
          <EmptyState title="No notifications match this filter" description="Try a different filter, or generate alerts to check for overdue packets, pending signatures, and validation failures." icon={<Bell className="h-8 w-8" />} />
        </CardContent>
      </Card>
    )
  }

  const groups = new Map<string, NotificationRow[]>()
  for (const n of notifications) {
    const label = groupLabel(n.createdAt)
    if (!groups.has(label)) groups.set(label, [])
    groups.get(label)!.push(n)
  }

  return (
    <div className="space-y-4">
      {Array.from(groups.entries()).map(([label, items]) => (
        <Card key={label}>
          <div className="flex items-center justify-between border-b border-surface-100 px-4 py-2.5">
            <p className="text-sm font-semibold text-surface-700">{label}</p>
            <Badge variant="secondary" size="sm">{items.length}</Badge>
          </div>
          <div className="divide-y divide-surface-100">
            {items.map((n) => {
              const config = typeConfig[n.type] || typeConfig.info
              const Icon = config.icon
              const isUnread = !n.readAt && !n.dismissedAt
              const isFocused = focusId === n.id

              return (
                <div key={n.id} className={`flex items-start gap-3 p-4 transition-colors ${isFocused ? "bg-brand-50/60 ring-1 ring-inset ring-brand-200" : isUnread ? "bg-brand-50/20" : ""} ${n.dismissedAt ? "opacity-60" : "hover:bg-surface-50"}`}>
                  <Link href={`/notifications?focus=${n.id}`} className="flex flex-1 items-start gap-3 min-w-0">
                    <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${config.color}`}>
                      <Icon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="mb-0.5 flex items-center gap-2">
                        <Badge variant={config.severity} size="sm">{config.label}</Badge>
                        <p className={`truncate text-sm font-medium ${isUnread ? "text-surface-900" : "text-surface-700"}`}>{n.title}</p>
                        {isUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-500" />}
                      </div>
                      <p className="truncate text-sm text-surface-500">{n.message}</p>
                      <p className="mt-1 text-xs text-surface-400">{formatDateTime(n.createdAt)}</p>
                    </div>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    {n.link && (
                      <Link href={n.link}><Button variant="secondary" size="sm"><Eye className="h-4 w-4" /> Open</Button></Link>
                    )}
                    {!n.readAt && (
                      <form action={async () => { "use server"; await markNotificationRead(n.id) }}>
                        <Button type="submit" variant="ghost" size="icon-sm" title="Mark read"><CheckCircle2 className="h-4 w-4 text-surface-400" /></Button>
                      </form>
                    )}
                    {!n.dismissedAt && (
                      <form action={async () => { "use server"; await dismissNotification(n.id) }}>
                        <Button type="submit" variant="ghost" size="icon-sm" title="Archive"><X className="h-4 w-4 text-surface-400" /></Button>
                      </form>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </Card>
      ))}
    </div>
  )
}

export function GenerateAlertsButton({ orgId }: { orgId: string }) {
  return (
    <form action={async () => { "use server"; await generateNotifications(orgId) }}>
      <Button type="submit" size="sm" variant="secondary"><RefreshCw className="h-4 w-4" /> Generate Alerts</Button>
    </form>
  )
}
