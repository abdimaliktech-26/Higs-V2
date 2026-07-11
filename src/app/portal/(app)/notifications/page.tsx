import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalNotifications, generatePortalDueDateReminders } from "@/lib/actions/portal-dashboard"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { Bell, Building2 } from "lucide-react"
import { NotificationList } from "./notification-list"

export const dynamic = "force-dynamic"

export default async function PortalNotificationsPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  await generatePortalDueDateReminders(currentClientId)
  const notifications = await getPortalNotifications()

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Notifications</h1>
          <p className="mt-1 text-sm text-surface-500">Updates about your portal account</p>
        </div>

        <Card>
          <CardContent className="p-0">
            {notifications.length === 0 ? (
              <div className="px-6 py-16">
                <EmptyState title="No notifications yet" description="You're all caught up." icon={<Bell className="h-8 w-8" />} />
              </div>
            ) : (
              <NotificationList
                notifications={notifications.map((n) => ({ ...n, link: n.link ?? "/portal/notifications" }))}
              />
            )}
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
