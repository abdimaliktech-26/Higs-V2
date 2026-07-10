"use client"

import { usePathname } from "next/navigation"
import Link from "next/link"
import { cn } from "@/lib/utils"
import { ChevronRight, Slash } from "lucide-react"

const routeLabels: Record<string, string> = {
  dashboard: "Dashboard",
  clients: "Clients",
  packets: "Packets",
  documents: "Documents",
  "pdf-editor": "PDF Editor",
  validation: "Validation Center",
  signatures: "Signature Workflow",
  approvals: "Approval Center",
  audit: "Audit Center",
  reports: "Reports",
  library: "Document Library",
  templates: "Templates & Forms",
  settings: "Settings",
  users: "User Management",
  profile: "Profile & Account",
  organization: "Organization Settings",
  help: "Help Center",
  training: "Training Center",
  "ai-copilot": "AI Compliance Copilot",
  integrations: "Integrations Marketplace",
  automation: "AI Automation Studio",
  "command-center": "Executive Command Center",
}

export function Breadcrumbs({ className }: { className?: string }) {
  const pathname = usePathname()
  const segments = pathname.split("/").filter(Boolean)

  if (segments.length === 0) return null

  const breadcrumbs = segments.map((segment, index) => {
    const href = "/" + segments.slice(0, index + 1).join("/")
    const label = routeLabels[segment] || segment.charAt(0).toUpperCase() + segment.slice(1).replace(/-/g, " ")
    return { label, href, isLast: index === segments.length - 1 }
  })

  return (
    <nav className={cn("flex items-center gap-1.5 text-sm", className)}>
      {breadcrumbs.map((crumb) => (
        <div key={crumb.href} className="flex items-center gap-1.5">
          <Slash className="h-4 w-4 text-surface-300 first:hidden" />
          {crumb.isLast ? (
            <span className="font-medium text-surface-700">{crumb.label}</span>
          ) : (
            <Link href={crumb.href} className="text-surface-500 hover:text-surface-700 transition-colors">
              {crumb.label}
            </Link>
          )}
        </div>
      ))}
    </nav>
  )
}
