"use client"

import { useSession } from "next-auth/react"
import { useRouter, usePathname } from "next/navigation"
import { Sidebar } from "./sidebar"
import { Topbar } from "./topbar"
import { cn } from "@/lib/utils"
import { LoadingState } from "@/components/ui/states"
import { useEffect } from "react"

interface AppShellProps {
  children: React.ReactNode
}

export function AppShellContent({ children }: AppShellProps) {
  const { data: session, status } = useSession()
  const router = useRouter()
  const pathname = usePathname()

  useEffect(() => {
    if (status === "unauthenticated") {
      router.push("/login")
    }
  }, [status, router])

  if (status === "loading") {
    return (
      <div className="flex h-screen items-center justify-center">
        <LoadingState title="Loading your workspace..." />
      </div>
    )
  }

  if (status === "unauthenticated") {
    return null
  }

  const user = session?.user as Record<string, unknown> | undefined
  const activeOrgId = user?.activeOrganizationId as string | undefined
  const memberships = (user?.memberships as Record<string, unknown>[]) ?? []
  const isSuperAdmin = user?.isSuperAdmin as boolean || false

  // Super admin doesn't need an active org
  if (!activeOrgId && !isSuperAdmin) {
    router.push("/login")
    return null
  }

  const activeMembership = memberships.find((m: Record<string, unknown>) => m.organizationId === activeOrgId)
  const activeRole = activeMembership?.role as string || "SUPER_ADMIN"
  const orgName = activeMembership?.organizationName as string | undefined

  return (
    <div className="flex h-screen overflow-hidden bg-[#f6f9fd]">
      <Sidebar userRole={activeRole} isSuperAdmin={isSuperAdmin} userName={user?.name as string | undefined} />
      <div className="flex flex-1 flex-col overflow-hidden min-w-0">
        <Topbar organizationName={orgName} />
        <main className="flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-none p-4 xl:p-5">
            {children}
          </div>
        </main>
      </div>
    </div>
  )
}
