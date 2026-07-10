import { Suspense } from "react"
import { auth } from "@/lib/auth"
import { redirect } from "next/navigation"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { SignatureDetailContent } from "./signature-detail-content"
import { PageSkeleton } from "@/components/ui/states"

export const dynamic = "force-dynamic"

export default async function SignatureDetailPage(props: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")
  const { id } = await props.params

  return (
    <SessionProvider>
      <AppShellContent>
        <Suspense fallback={<PageSkeleton />}>
          <SignatureDetailContent requestId={id} />
        </Suspense>
      </AppShellContent>
    </SessionProvider>
  )
}
