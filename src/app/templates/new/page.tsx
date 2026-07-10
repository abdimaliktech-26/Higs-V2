import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { UploadFormContent } from "./upload-form-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function UploadTemplatePage(props: { searchParams?: Promise<{ tab?: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string | undefined
  if (!orgId) redirect("/login")
  const sp = await props.searchParams
  const initialTab = sp?.tab === "packet" ? "packet" : "form"

  return (
    <SessionProvider>
      <AppShellContent>
        <div className="mx-auto max-w-3xl">
          <div className="mb-6">
            <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Upload Form Template</h1>
            <p className="mt-1 text-sm text-surface-500">Upload a DHS PDF form or define a new packet template</p>
          </div>
          <Suspense fallback={<PageSkeleton />}>
            <UploadFormContent orgId={orgId} initialTab={initialTab} />
          </Suspense>
        </div>
      </AppShellContent>
    </SessionProvider>
  )
}
