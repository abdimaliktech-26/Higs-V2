import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { LibraryContent } from "./library-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function LibraryPage(props: { searchParams?: Promise<{ tab?: string; search?: string; status?: string }> }) {
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
          <LibraryContent orgId={orgId} isSuperAdmin={user.isSuperAdmin as boolean} tab={sp?.tab} search={sp?.search} status={sp?.status} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
