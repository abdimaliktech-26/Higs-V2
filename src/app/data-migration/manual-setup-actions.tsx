import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { UserPlus, FolderPlus, Upload, ScrollText, ShieldCheck, SearchCheck, type LucideIcon } from "lucide-react"

interface Action { icon: LucideIcon; label: string; href: string }

const actions: Action[] = [
  { icon: UserPlus, label: "Add Client", href: "/clients/new" },
  { icon: FolderPlus, label: "Create Packet", href: "/packets/new" },
  { icon: Upload, label: "Upload Supporting Document", href: "/library?tab=supporting" },
  { icon: ScrollText, label: "Manage Templates", href: "/templates" },
  { icon: ShieldCheck, label: "Open Validation Center", href: "/validation" },
  { icon: SearchCheck, label: "View Audit Activity", href: "/audit" },
]

export function ManualSetupActionsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Manual Setup Actions</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {actions.map((a) => (
            <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-4 text-center hover:bg-surface-50">
              <a.icon className="h-5 w-5 text-brand-600" />
              <span className="text-xs font-medium text-surface-700">{a.label}</span>
            </Link>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
