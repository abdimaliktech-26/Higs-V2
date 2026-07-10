import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { PageSkeleton, EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { SearchContent } from "./search-content"

export const dynamic = "force-dynamic"

export default async function SearchPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const isSuperAdmin = user.isSuperAdmin as boolean
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId && !isSuperAdmin) redirect("/login")

  const searchParams = (await props.searchParams) ?? {}

  if (!orgId) {
    return (
      <SessionProvider>
        <AppShellContent>
          <div className="rounded-xl border border-surface-200 bg-white p-16">
            <EmptyState title="Switch to an organization" description="Select an organization to use Global Search." icon={<Building2 className="h-8 w-8" />} />
          </div>
        </AppShellContent>
      </SessionProvider>
    )
  }

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <SearchContent orgId={orgId} searchParams={searchParams} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
