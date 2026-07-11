import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { PageSkeleton } from "@/components/ui/states"
import { getActiveRole } from "@/lib/permissions"
import { TemplateFieldEditor } from "./template-field-editor"

export const dynamic = "force-dynamic"

const MANAGE_ROLES = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

export default async function TemplateFieldEditorPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const isSuperAdmin = user.isSuperAdmin as boolean
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")

  const role = getActiveRole(user as any)
  if (!isSuperAdmin && !MANAGE_ROLES.includes(role)) redirect("/templates")

  const { id } = await params

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <TemplateFieldEditor templateId={id} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
