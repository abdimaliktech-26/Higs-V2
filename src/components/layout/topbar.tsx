"use client"

import { useState } from "react"
import { useSession, signOut } from "next-auth/react"
import { useRouter } from "next/navigation"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { SearchInput } from "@/components/ui/search-input"
import { Bell, LogOut, UserCircle, Building2, ChevronDown, HelpCircle, FileText } from "lucide-react"
import Link from "next/link"

interface TopbarProps {
  organizationName?: string
}

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Super Admin",
  ORG_ADMIN: "Organization Admin",
  COMPLIANCE_DIRECTOR: "Compliance Director",
  CASE_MANAGER: "Case Manager",
  DSP: "DSP / Staff",
  NURSE: "Nurse",
  BILLING_ADMIN: "Billing Admin",
  GUARDIAN: "Guardian / Family",
  EXTERNAL_CASE_MANAGER: "External Case Manager",
}

export function Topbar({ organizationName }: TopbarProps) {
  const { data: session } = useSession()
  const router = useRouter()
  const [showMenu, setShowMenu] = useState(false)

  const user = session?.user as Record<string, unknown> | undefined
  const name = user?.name as string | undefined
  const email = user?.email as string | undefined
  const memberships = (user?.memberships as Record<string, unknown>[]) ?? []
  const activeOrgId = user?.activeOrganizationId as string | undefined
  const activeMembership = memberships.find((m: Record<string, unknown>) => m.organizationId === activeOrgId)
  const activeRole = activeMembership?.role as string | undefined

  return (
    <header className="flex h-14 items-center justify-between gap-4 border-b border-surface-200 bg-white px-5">
      <div className="hidden min-w-0 flex-1 md:block" />

      <div className="hidden w-full max-w-[440px] md:block">
        <form action="/search" className="relative">
          <SearchInput
            name="q"
            placeholder="Search clients, packets, events, staff, reviews..."
            className="h-9 rounded-md border-surface-200 pr-14 text-xs shadow-sm"
          />
          <button type="submit" className="sr-only">Search</button>
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-surface-200 bg-white px-1.5 py-0.5 text-[10px] font-bold text-navy-700">⌘ K</span>
        </form>
      </div>

      <div className="flex min-w-0 flex-1 items-center justify-end gap-2">

        {/* Notifications */}
        <Link href="/notifications" className="relative rounded-md p-2 text-navy-700 transition-colors hover:bg-surface-100">
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 flex h-2 w-2 rounded-full bg-danger-500 ring-2 ring-white" />
        </Link>
        <Link href="/help" className="rounded-md p-2 text-navy-700 transition-colors hover:bg-surface-100">
          <HelpCircle className="h-4 w-4" />
        </Link>

        {/* Org indicator */}
        {organizationName && (
          <div className="hidden items-center gap-2 rounded-md border border-surface-200 bg-white px-3 py-1.5 shadow-sm lg:flex">
            <FileText className="h-3.5 w-3.5 text-brand-700" />
            <span className="max-w-44 truncate text-[11px] font-bold text-navy-800">{organizationName}</span>
            <ChevronDown className="h-3.5 w-3.5 text-surface-400" />
          </div>
        )}

        {/* User menu */}
        <div className="relative">
          <button
            onClick={() => setShowMenu(!showMenu)}
            className="flex items-center gap-2 rounded-lg p-1.5 hover:bg-surface-100 transition-colors"
          >
            <Avatar size="sm">
              <AvatarFallback name={name} />
            </Avatar>
            <div className="hidden text-left lg:block">
              <p className="text-xs font-bold leading-tight text-navy-950">{name || "User"}</p>
              <p className="text-[10px] leading-tight text-surface-500">
                {activeRole ? roleLabels[activeRole] : "User"}
              </p>
            </div>
            <ChevronDown className="hidden h-4 w-4 text-surface-400 lg:block" />
          </button>

          {showMenu && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setShowMenu(false)} />
              <div className="absolute right-0 z-50 mt-1.5 w-56 rounded-xl border border-surface-200 bg-white shadow-lg py-1">
                <div className="border-b border-surface-100 px-4 py-3">
                  <p className="text-sm font-medium text-surface-900">{name}</p>
                  <p className="text-xs text-surface-500">{email}</p>
                </div>
                <div className="py-1">
                  <button
                    disabled
                    title="Profile & Account settings are coming soon"
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-surface-400 cursor-not-allowed"
                  >
                    <UserCircle className="h-4 w-4 opacity-50" />
                    Profile & Account
                    <span className="ml-auto text-[10px] opacity-60">Soon</span>
                  </button>
                  <button
                    onClick={() => { router.push("/settings/organization"); setShowMenu(false) }}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-surface-700 hover:bg-surface-50"
                  >
                    <Building2 className="h-4 w-4" />
                    Organization Settings
                  </button>
                </div>
                <div className="border-t border-surface-100 py-1">
                  <button
                    onClick={() => signOut({ callbackUrl: "/login" })}
                    className="flex w-full items-center gap-2 px-4 py-2 text-sm text-danger-600 hover:bg-danger-50"
                  >
                    <LogOut className="h-4 w-4" />
                    Sign Out
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </header>
  )
}
