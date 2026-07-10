import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { EditClientForm } from "./edit-client-form"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function EditClientPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const { id } = await props.params

  return (
    <SessionProvider>
      <AppShellContent>
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Edit Client</h1>
            <p className="mt-1 text-sm text-surface-500">Update client information and records</p>
          </div>
          <Suspense fallback={<PageSkeleton />}>
            <EditClientForm clientId={id} />
          </Suspense>
        </div>
      </AppShellContent>
    </SessionProvider>
  )
}
