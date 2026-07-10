import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { ValidationResultContent } from "./validation-result-content"
import { PageSkeleton } from "@/components/ui/states"
import { Suspense } from "react"

export const dynamic = "force-dynamic"

export default async function ValidationResultPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const { id } = await props.params

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <ValidationResultContent resultId={id} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
