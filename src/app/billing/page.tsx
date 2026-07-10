import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { PageSkeleton } from "@/components/ui/states"
import { BillingContent } from "./billing-content"

export const dynamic = "force-dynamic"

export default async function BillingPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId && !(user.isSuperAdmin as boolean)) redirect("/login")

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <BillingContent orgId={orgId!} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
