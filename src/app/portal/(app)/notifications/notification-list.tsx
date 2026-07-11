"use client"

import { useTransition } from "react"
import { useRouter } from "next/navigation"
import { formatDateTime } from "@/lib/utils"
import { markPortalNotificationRead } from "@/lib/actions/portal-dashboard"

export interface PortalNotificationRow {
  id: string
  type: string
  title: string
  message: string
  link: string
  readAt: Date | null
  createdAt: Date
}

export function NotificationList({ notifications }: { notifications: PortalNotificationRow[] }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()

  function handleOpen(notification: PortalNotificationRow) {
    if (!notification.readAt) {
      startTransition(async () => {
        await markPortalNotificationRead(notification.id)
        router.refresh()
      })
    }
    router.push(notification.link)
  }

  function handleMarkRead(e: React.MouseEvent, notificationId: string) {
    e.stopPropagation()
    startTransition(async () => {
      await markPortalNotificationRead(notificationId)
      router.refresh()
    })
  }

  return (
    <div className="divide-y divide-surface-100">
      {notifications.map((n) => (
        <button
          key={n.id}
          type="button"
          onClick={() => handleOpen(n)}
          disabled={isPending}
          className="flex w-full items-start justify-between gap-4 px-6 py-4 text-left transition hover:bg-surface-50"
        >
          <div>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-surface-900">{n.title}</p>
              {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand-600" />}
            </div>
            <p className="mt-0.5 text-sm text-surface-600">{n.message}</p>
            <p className="mt-1 text-xs text-surface-400">{formatDateTime(n.createdAt)}</p>
          </div>
          {!n.readAt && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => handleMarkRead(e, n.id)}
              className="shrink-0 whitespace-nowrap text-xs font-medium text-brand-700 hover:underline"
            >
              Mark as read
            </span>
          )}
        </button>
      ))}
    </div>
  )
}
