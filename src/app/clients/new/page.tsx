import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { ClientForm } from "./client-form"
import { PageSkeleton } from "@/components/ui/states"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export const dynamic = "force-dynamic"

export default async function NewClientPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId && !(user.isSuperAdmin as boolean)) redirect("/login")

  return (
    <SessionProvider>
      <AppShellContent>
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Add Client</h1>
            <p className="mt-1 text-sm text-surface-500">Create a new client record in your organization</p>
          </div>
          <Suspense fallback={<PageSkeleton />}>
            <ClientForm />
          </Suspense>
        </div>
      </AppShellContent>
    </SessionProvider>
  )
}
