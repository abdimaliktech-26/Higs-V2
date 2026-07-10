import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { PDFEditorClient } from "./pdf-editor-client"
import { Suspense } from "react"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function PDFEditorPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const { id } = await props.params

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <PDFEditorClient documentId={id} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
