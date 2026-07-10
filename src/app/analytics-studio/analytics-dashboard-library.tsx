import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Search } from "lucide-react"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface LibraryItem { label: string; href?: string }

const items: LibraryItem[] = [
  { label: "Executive Overview", href: "/analytics-studio" },
  { label: "Compliance Dashboard", href: "/reports?report=compliance" },
  { label: "Client Outcomes", href: "/clients" },
  { label: "Operations Overview", href: "/reports" },
  { label: "Incident Analysis" },
  { label: "Staff Performance", href: "/reports?report=staff" },
  { label: "Financial Overview" },
  { label: "Audit Readiness", href: "/audit" },
  { label: "Custom Reports" },
]

export function DashboardLibraryCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Dashboard Library</CardTitle></CardHeader>
      <CardContent>
        <Input placeholder="Search dashboards…" disabled title={NOT_WIRED} leftIcon={<Search className="h-4 w-4" />} className="mb-3" />
        <nav className="space-y-1">
          {items.map((item, i) => (
            item.href ? (
              <Link key={item.label} href={item.href} className={`block rounded-lg px-3 py-2 text-sm ${i === 0 ? "bg-brand-50 font-medium text-brand-700" : "text-surface-600 hover:bg-surface-50"}`}>
                {item.label}
              </Link>
            ) : (
              <span key={item.label} title={NOT_WIRED} className="block cursor-not-allowed rounded-lg px-3 py-2 text-sm text-surface-300">
                {item.label} <span className="text-[10px]">Coming soon</span>
              </span>
            )
          ))}
        </nav>
      </CardContent>
    </Card>
  )
}
