import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { DashboardContent } from "./dashboard-content"
import { PageSkeleton } from "@/components/ui/states"
import { getActiveRole } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const isSuperAdmin = user.isSuperAdmin as boolean
  const activeOrgId = user.activeOrganizationId as string | undefined

  if (!isSuperAdmin && !activeOrgId) redirect("/login")

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <DashboardContent
            orgId={activeOrgId}
            isSuperAdmin={isSuperAdmin}
            userId={user.id as string}
            userName={user.name as string | undefined}
            role={getActiveRole(user as any)}
          />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
