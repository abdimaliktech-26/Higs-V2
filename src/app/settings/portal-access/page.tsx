import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { PageSkeleton, EmptyState } from "@/components/ui/states"
import { Building2 } from "lucide-react"
import { getActiveRole } from "@/lib/permissions"
import { PortalAccessContent } from "./portal-access-content"

export const dynamic = "force-dynamic"

const MANAGE_ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

export default async function PortalAccessPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const isSuperAdmin = user.isSuperAdmin as boolean
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId && !isSuperAdmin) redirect("/login")

  if (!orgId) {
    return (
      <SessionProvider>
        <AppShellContent>
          <div className="rounded-xl border border-surface-200 bg-white p-16">
            <EmptyState title="Switch to an organization" description="Select an organization to manage portal access." icon={<Building2 className="h-8 w-8" />} />
          </div>
        </AppShellContent>
      </SessionProvider>
    )
  }

  const role = getActiveRole(user as any)
  if (!isSuperAdmin && !MANAGE_ROLES.includes(role)) redirect("/dashboard")

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <PortalAccessContent orgId={orgId} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
