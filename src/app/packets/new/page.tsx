import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { CreatePacketForm } from "./create-packet-form"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function CreatePacketPage(props: { searchParams?: Promise<{ clientId?: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")

  const sp = await props.searchParams

  return (
    <SessionProvider>
      <AppShellContent>
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Create Packet</h1>
            <p className="mt-1 text-sm text-surface-500">Create a new compliance packet from a template</p>
          </div>
          <Suspense fallback={<PageSkeleton />}>
            <CreatePacketForm orgId={orgId} preselectedClientId={sp?.clientId} />
          </Suspense>
        </div>
      </AppShellContent>
    </SessionProvider>
  )
}
