import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { OnboardingContent } from "./onboarding-content"
import { PageSkeleton } from "@/components/ui/states"
import { getActiveRole, type SessionUser } from "@/lib/permissions"
import { UserRole } from "@prisma/client"

export const dynamic = "force-dynamic"

// Matches MANAGE_ROLES in src/lib/actions/users.ts (updateOrgSettings)
const ALLOWED_ROLES: UserRole[] = ["ORG_ADMIN"]

export default async function OnboardingPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as unknown as SessionUser
  const isSuperAdmin = user.isSuperAdmin
  const orgId = user.activeOrganizationId
  if (!isSuperAdmin && !orgId) redirect("/login")

  const role = getActiveRole(user)
  if (!isSuperAdmin && !ALLOWED_ROLES.includes(role)) redirect("/dashboard")

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <OnboardingContent orgId={orgId} isSuperAdmin={isSuperAdmin} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
