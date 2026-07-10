import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { TemplatesListContent } from "./templates-list-content"
import { PageSkeleton } from "@/components/ui/states"
import { getActiveRole } from "@/lib/permissions"

export const dynamic = "force-dynamic"

export default async function TemplatesPage(props: {
  searchParams?: Promise<{ search?: string; status?: string; program?: string; packetType?: string; formType?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")
  const sp = await props.searchParams
  const role = getActiveRole(user as any)

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <TemplatesListContent
            orgId={orgId}
            role={role}
            isSuperAdmin={user.isSuperAdmin as boolean}
            search={sp?.search}
            status={sp?.status}
            programFilter={sp?.program}
            packetType={sp?.packetType}
            formType={sp?.formType}
          />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
