import Link from "next/link"
import { markNotificationRead, dismissNotification } from "@/lib/actions/notifications"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { StatusChip } from "@/components/ui/status-chip"
import { EmptyState } from "@/components/ui/states"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { UserCog, FolderOpen, User, CheckCircle2, Archive, Clock3, MousePointerClick } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import type { FocusPacketContext } from "./notifications-data"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface FocusNotification {
  id: string; type: string; title: string; message: string
  link: string | null; createdAt: Date; readAt: Date | null; metadata: unknown
}

export function NotificationsFocusPanel({ notification, packet }: { notification: FocusNotification | null; packet: FocusPacketContext | null }) {
  if (!notification) {
    return (
      <Card>
        <CardContent className="py-16">
          <EmptyState
            icon={<MousePointerClick className="h-8 w-8" />}
            title="Select a notification"
            description="Choose an item from the timeline on the left to see its full details here."
          />
        </CardContent>
      </Card>
    )
  }

  const meta = (notification.metadata as Record<string, unknown>) || {}
  const progressPct = packet && packet.documentsTotal > 0 ? Math.round((packet.documentsCompleted / packet.documentsTotal) * 100) : null

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <div>
          <Badge variant="danger" size="sm">{notification.type.replace(/_/g, " ")}</Badge>
          <CardTitle className="mt-2">{notification.title}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        <p className="text-sm text-surface-600">{notification.message}</p>

        {packet && (
          <div className="rounded-lg border border-surface-100 p-4">
            <div className="flex items-center gap-3">
              <Avatar size="md"><AvatarFallback name={`${packet.client.firstName} ${packet.client.lastName}`} /></Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-surface-900">{packet.client.firstName} {packet.client.lastName}</p>
                <p className="text-xs text-surface-400">{packet.client.mcadId || "—"}</p>
              </div>
              <div className="text-right text-xs text-surface-500">
                <p>Program</p>
                <p className="font-medium text-surface-900">{packet.programName || "—"}</p>
              </div>
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-surface-900 capitalize">{packet.packetType.replace(/_/g, " ")}</p>
                <p className="text-xs text-surface-400">Packet</p>
              </div>
              <StatusChip status={packet.status} size="sm" />
            </div>

            {progressPct !== null && (
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-surface-500"><span>Document Progress</span><span>{progressPct}%</span></div>
                <Progress value={progressPct} size="sm" variant={progressPct >= 80 ? "success" : "warning"} />
              </div>
            )}
          </div>
        )}

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Details</p>
          <div className="space-y-1 text-sm text-surface-600">
            {Object.entries(meta).length === 0 ? (
              <p className="text-xs text-surface-400">No additional details recorded.</p>
            ) : (
              Object.entries(meta).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><span className="capitalize text-surface-500">{k.replace(/([A-Z])/g, " $1")}</span><span className="font-medium text-surface-900">{String(v)}</span></div>
              ))
            )}
          </div>
        </div>

        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Activity</p>
          <div className="flex items-center gap-2 text-xs text-surface-500">
            <Clock3 className="h-3.5 w-3.5" />
            Created {formatDateTime(notification.createdAt)}
            {notification.readAt && <span>· Read {formatDateTime(notification.readAt)}</span>}
          </div>
        </div>

        {notification.link && (
          <Link href={notification.link}><Button variant="primary" size="sm" fullWidth>Open {notification.type === "validation_failure" ? "Validation Center" : "Details"}</Button></Link>
        )}

        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><UserCog className="h-4 w-4" /> Assign</Button>
          {meta.packetId ? (
            <Link href={`/packets/${meta.packetId}`}><Button variant="secondary" size="sm" fullWidth><FolderOpen className="h-4 w-4" /> Open Packet</Button></Link>
          ) : (
            <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><FolderOpen className="h-4 w-4" /> Open Packet</Button>
          )}
          {packet ? (
            <Link href={`/clients/${packet.client.id}`}><Button variant="secondary" size="sm" fullWidth><User className="h-4 w-4" /> View Client Profile</Button></Link>
          ) : (
            <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><User className="h-4 w-4" /> View Client Profile</Button>
          )}
          <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Clock3 className="h-4 w-4" /> Snooze</Button>
        </div>

        <div className="grid grid-cols-2 gap-2">
          {!notification.readAt && (
            <form action={async () => { "use server"; await markNotificationRead(notification.id) }}>
              <Button type="submit" variant="secondary" size="sm" fullWidth><CheckCircle2 className="h-4 w-4" /> Mark as Read</Button>
            </form>
          )}
          <form action={async () => { "use server"; await dismissNotification(notification.id) }}>
            <Button type="submit" variant="secondary" size="sm" fullWidth><Archive className="h-4 w-4" /> Archive</Button>
          </form>
        </div>
      </CardContent>
    </Card>
  )
}
