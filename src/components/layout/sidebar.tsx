"use client"

import { useState, useCallback } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { mainNavItems, secondaryNavItems, stubNavItems, NavItem } from "./nav-items"
import { ChevronLeft, ChevronRight, MoreHorizontal } from "lucide-react"

interface SidebarProps {
  userRole: string
  isSuperAdmin: boolean
  userName?: string
}

function NavLink({ item, collapsed, pathname, isStub }: { item: NavItem; collapsed: boolean; pathname: string; isStub?: boolean }) {
  const Icon = item.icon
  const isActive = pathname === item.href || pathname.startsWith(item.href + "/")

  return (
    <Link
      href={item.href}
      className={cn(
        "group flex items-center gap-2.5 rounded-md px-3 py-2 text-[11px] font-semibold transition-all",
        collapsed && "justify-center px-2",
        isActive
          ? "bg-brand-600 text-white shadow-sm"
          : isStub
            ? "cursor-not-allowed text-white/35 hover:text-white/45"
            : "text-white/82 hover:bg-white/10 hover:text-white"
      )}
      title={collapsed ? item.title : undefined}
      onClick={isStub ? (e) => e.preventDefault() : undefined}
    >
      <Icon className={cn("h-4 w-4 shrink-0", isStub && "opacity-50")} />
      {!collapsed && (
        <>
          <span className="flex-1 truncate">{item.title}</span>
          {item.badge !== undefined && (
            <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-danger-500 px-1.5 text-[10px] font-bold text-white">
              {item.badge}
            </span>
          )}
          {isStub && <span className="text-[10px] opacity-60">Soon</span>}
        </>
      )}
    </Link>
  )
}

export function Sidebar({ userRole, isSuperAdmin, userName }: SidebarProps) {
  const [collapsed, setCollapsed] = useState(false)
  const pathname = usePathname()

  const filterByRole = useCallback((items: NavItem[]) =>
    items.filter((item) => isSuperAdmin || item.roles.includes(userRole)),
    [userRole, isSuperAdmin]
  )

  return (
    <aside
      className={cn(
        "flex flex-col border-r border-[#0b2a5c] bg-[#061b3f] text-white transition-all duration-300 shrink-0",
        collapsed ? "w-[58px]" : "w-40"
      )}
    >
      {/* Logo */}
      <div className={cn(
        "flex h-14 items-center border-b border-white/10",
        collapsed ? "justify-center" : "gap-2.5 px-4"
      )}>
        <div className="grid h-7 w-7 grid-cols-2 gap-1">
          <span className="rounded-full bg-brand-500" />
          <span className="rounded-full bg-brand-400" />
          <span className="col-span-2 mx-auto h-3 w-3 rounded-full bg-brand-700" />
        </div>
        {!collapsed && (
          <span className="text-xl font-bold leading-none text-white">Higsi</span>
        )}
      </div>

      {/* Navigation */}
      <div className="flex-1 overflow-y-auto px-2 py-4">
        {/* Main */}
        <div>
          <nav className="space-y-0.5">
            {filterByRole(mainNavItems).map((item) => (
              <NavLink key={`${item.href}-${item.title}`} item={item} collapsed={collapsed} pathname={pathname} />
            ))}
          </nav>
        </div>

        {/* Settings */}
        <div className="mt-1">
          <nav className="space-y-0.5">
            {filterByRole(secondaryNavItems).map((item) => (
              <NavLink key={`${item.href}-${item.title}`} item={item} collapsed={collapsed} pathname={pathname} />
            ))}
          </nav>
        </div>

        {/* Coming soon */}
        {!collapsed && (
          <div className="mt-1">
            <nav className="space-y-0.5">
              {filterByRole(stubNavItems).map((item) => (
                <NavLink key={`${item.href}-${item.title}`} item={item} collapsed={collapsed} pathname={pathname} isStub />
              ))}
            </nav>
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <div className="border-t border-white/10 p-2">
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="flex w-full items-center justify-center rounded-lg py-2 text-white/70 transition-colors hover:bg-white/10 hover:text-white"
          title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>
      </div>
    </aside>
  )
}
