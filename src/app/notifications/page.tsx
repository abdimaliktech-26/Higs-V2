import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { NotificationsContent } from "./notifications-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function NotificationsPage(props: { searchParams?: Promise<{ filter?: string; focus?: string; q?: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")
  const sp = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <NotificationsContent orgId={orgId} filter={sp?.filter} focus={sp?.focus} q={sp?.q} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
