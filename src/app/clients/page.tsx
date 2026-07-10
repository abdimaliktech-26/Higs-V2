import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { ClientsListContent } from "./client-list-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function ClientsPage(props: {
  searchParams?: Promise<{ search?: string; status?: string; program?: string; packetStatus?: string; caseManager?: string; page?: string; pageSize?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  const isSuperAdmin = user.isSuperAdmin as boolean

  if (!orgId && !isSuperAdmin) redirect("/login")

  const searchParams = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <ClientsListContent
            orgId={orgId}
            isSuperAdmin={isSuperAdmin}
            search={searchParams?.search}
            status={searchParams?.status}
            programFilter={searchParams?.program}
            packetStatus={searchParams?.packetStatus}
            caseManager={searchParams?.caseManager}
            page={searchParams?.page ? parseInt(searchParams.page) : 1}
            pageSize={searchParams?.pageSize ? parseInt(searchParams.pageSize) : undefined}
          />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
