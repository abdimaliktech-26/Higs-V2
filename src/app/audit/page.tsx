import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { AuditListContent } from "./audit-list-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function AuditCenterPage(props: { searchParams?: Promise<{ action?: string; search?: string; page?: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId && !(user.isSuperAdmin as boolean)) redirect("/login")
  const sp = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <AuditListContent orgId={orgId} isSuperAdmin={user.isSuperAdmin as boolean} action={sp?.action} search={sp?.search} page={sp?.page ? parseInt(sp.page) : 1} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
