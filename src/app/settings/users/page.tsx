import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { UsersListContent } from "./users-list-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function UsersPage() {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <UsersListContent orgId={orgId} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
