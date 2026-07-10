import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { WorkQueueContent } from "./work-queue-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function TasksPage(props: { searchParams?: Promise<{ tab?: string; page?: string; focus?: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")
  const sp = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <WorkQueueContent orgId={orgId} tab={sp?.tab} page={sp?.page ? Number(sp.page) : undefined} focus={sp?.focus} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
