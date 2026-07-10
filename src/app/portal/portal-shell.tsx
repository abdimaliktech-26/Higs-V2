"use client"

import { useRouter, useSearchParams, usePathname } from "next/navigation"
import { useState } from "react"
import Link from "next/link"
import { portalLogout } from "@/lib/actions/portal-auth"
import { Select } from "@/components/ui/select"
import {
  LayoutDashboard, FileText, Users, Bell, Settings, LogOut,
  MessageSquare, Calendar, Upload, PenSquare, Lock,
} from "lucide-react"

interface AuthorizedClient {
  clientId: string
  displayName: string
  relationship: string
  accessRole: string
}

interface Props {
  clients: AuthorizedClient[]
  currentClientId: string
  children: React.ReactNode
}

const navItems = [
  { href: "/portal/dashboard", label: "Home", icon: LayoutDashboard },
  { href: "/portal/documents", label: "Documents", icon: FileText },
  { href: "/portal/care-team", label: "Care Team", icon: Users },
  { href: "/portal/notifications", label: "Notifications", icon: Bell },
  { href: "/portal/settings", label: "Settings", icon: Settings },
]

const comingSoonItems = [
  { label: "Messages", icon: MessageSquare },
  { label: "Appointments", icon: Calendar },
  { label: "Upload", icon: Upload },
  { label: "Signatures", icon: PenSquare },
]

export function PortalShell({ clients, currentClientId, children }: Props) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const [loggingOut, setLoggingOut] = useState(false)

  function withClient(href: string, clientId: string) {
    const params = new URLSearchParams(searchParams.toString())
    params.set("client", clientId)
    return `${href}?${params.toString()}`
  }

  async function handleLogout() {
    setLoggingOut(true)
    await portalLogout()
    router.push("/portal/login")
    router.refresh()
  }

  return (
    <div className="flex min-h-screen flex-col bg-surface-50 md:flex-row">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-surface-200 bg-white md:flex">
        <div className="flex items-center gap-3 p-6">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-600">
            <span className="text-lg font-bold text-white">H</span>
          </div>
          <div>
            <p className="text-sm font-bold text-surface-900">Higsi</p>
            <p className="text-xs text-surface-500">Client Portal</p>
          </div>
        </div>

        {clients.length > 1 && (
          <div className="px-4 pb-2">
            <Select
              label="Viewing"
              value={currentClientId}
              onChange={(e) => router.push(withClient(pathname, e.target.value))}
              options={clients.map((c) => ({ value: c.clientId, label: c.displayName }))}
            />
          </div>
        )}

        <nav className="flex-1 space-y-1 px-3 py-2">
          {navItems.map((item) => {
            const Icon = item.icon
            const active = pathname === item.href
            return (
              <Link
                key={item.href}
                href={withClient(item.href, currentClientId)}
                className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                  active ? "bg-brand-50 text-brand-700" : "text-surface-600 hover:bg-surface-50"
                }`}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            )
          })}

          <div className="mt-4 border-t border-surface-100 pt-4">
            <p className="px-3 pb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Coming Soon</p>
            {comingSoonItems.map((item) => {
              const Icon = item.icon
              return (
                <div key={item.label} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-surface-400" title="Not part of this stage — no backend yet">
                  <Icon className="h-4 w-4" />
                  {item.label}
                </div>
              )
            })}
          </div>
        </nav>

        <div className="border-t border-surface-100 p-4">
          <button
            onClick={handleLogout}
            disabled={loggingOut}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-surface-600 hover:bg-surface-50"
          >
            <LogOut className="h-4 w-4" />
            {loggingOut ? "Signing out..." : "Sign out"}
          </button>
          <div className="mt-3 flex items-center gap-1.5 px-3 text-xs text-surface-400">
            <Lock className="h-3 w-3" />
            HIPAA-compliant & secure
          </div>
        </div>
      </aside>

      <div className="flex-1 pb-20 md:pb-0">
        {clients.length > 1 && (
          <div className="border-b border-surface-200 bg-white px-4 py-3 md:hidden">
            <Select
              value={currentClientId}
              onChange={(e) => router.push(withClient(pathname, e.target.value))}
              options={clients.map((c) => ({ value: c.clientId, label: c.displayName }))}
            />
          </div>
        )}
        <main className="mx-auto max-w-4xl p-4 md:p-8">{children}</main>
      </div>

      <nav className="fixed inset-x-0 bottom-0 z-40 flex items-center justify-around border-t border-surface-200 bg-white py-2 md:hidden">
        {navItems.map((item) => {
          const Icon = item.icon
          const active = pathname === item.href
          return (
            <Link
              key={item.href}
              href={withClient(item.href, currentClientId)}
              className={`flex flex-col items-center gap-0.5 px-2 py-1 text-[11px] font-medium ${active ? "text-brand-700" : "text-surface-500"}`}
            >
              <Icon className="h-5 w-5" />
              {item.label}
            </Link>
          )
        })}
      </nav>
    </div>
  )
}
