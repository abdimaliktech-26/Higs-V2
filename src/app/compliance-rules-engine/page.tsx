import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { ComplianceRulesEngineContent } from "./compliance-rules-engine-content"
import { PageSkeleton } from "@/components/ui/states"
import { getActiveRole, type SessionUser } from "@/lib/permissions"
import { UserRole } from "@prisma/client"

export const dynamic = "force-dynamic"

// Matches MANAGE_ROLES in src/lib/actions/validation.ts
const ALLOWED_ROLES: UserRole[] = ["ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

export default async function ComplianceRulesEnginePage(props: {
  searchParams?: Promise<{ category?: string; severity?: string; program?: string; packetType?: string; active?: string; rule?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as unknown as SessionUser
  const isSuperAdmin = user.isSuperAdmin
  const orgId = user.activeOrganizationId
  if (!isSuperAdmin && !orgId) redirect("/login")

  const role = getActiveRole(user)
  if (!isSuperAdmin && !ALLOWED_ROLES.includes(role)) redirect("/dashboard")

  const sp = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <ComplianceRulesEngineContent
            orgId={orgId}
            isSuperAdmin={isSuperAdmin}
            category={sp?.category}
            severity={sp?.severity}
            program={sp?.program}
            packetType={sp?.packetType}
            active={sp?.active}
            rule={sp?.rule}
          />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
