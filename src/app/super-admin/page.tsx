import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { SuperAdminContent } from "./super-admin-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function SuperAdminPage(props: { searchParams?: Promise<{ q?: string; page?: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const isSuperAdmin = user.isSuperAdmin as boolean
  if (!isSuperAdmin) redirect("/dashboard")

  const sp = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <SuperAdminContent q={sp?.q} page={sp?.page ? Number(sp.page) : undefined} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
