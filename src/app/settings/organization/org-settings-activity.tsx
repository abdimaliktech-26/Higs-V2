import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge, type BadgeProps } from "@/components/ui/badge"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { EmptyState } from "@/components/ui/states"
import { MapPin, Building2, Users, FileUp, BellRing, ShieldCheck, History, FileInput } from "lucide-react"
import { timeAgo } from "@/lib/utils"
import { auditCategories, severityMap } from "@/app/audit/audit-categories"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface ActivityEvent {
  id: string
  action: string
  createdAt: Date
  actor: { name: string | null; email: string } | null
}

function categoryLabel(action: string): string {
  for (const cat of Object.values(auditCategories)) {
    if (cat.actions.includes(action)) return cat.label
  }
  return "System"
}

export function ActivityTimelineCard({ events }: { events: ActivityEvent[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Activity Timeline</CardTitle>
        <Link href="/audit" className="text-xs font-medium text-brand-600 hover:underline">View Activity</Link>
      </CardHeader>
      <CardContent>
        {events.length === 0 ? (
          <EmptyState className="py-8" title="No recent activity" description="Configuration events will appear here as they happen." />
        ) : (
          <ul className="space-y-3">
            {events.map((e) => (
              <li key={e.id} className="flex items-center gap-3">
                <Avatar size="sm"><AvatarFallback name={e.actor?.name} /></Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm text-surface-900">{e.actor?.name || "Unknown"} <span className="text-surface-400">·</span> <span className="text-surface-500">{e.action.replace(/_/g, " ").toLowerCase()}</span></p>
                </div>
                <Badge size="sm" variant={(severityMap[e.action] as BadgeProps["variant"]) || "secondary"}>{categoryLabel(e.action)}</Badge>
                <span className="w-20 shrink-0 text-right text-xs text-surface-400">{timeAgo(e.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function ConfigurationComparisonCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Configuration Comparison</CardTitle></CardHeader>
      <CardContent>
        <EmptyState
          className="py-8"
          icon={<History className="h-6 w-6" />}
          title="Configuration versioning not yet available"
          description="Current vs. previous configuration diffs will appear here once version history is tracked."
        />
        <Button variant="primary" size="sm" fullWidth disabled title={NOT_WIRED}>Review Changes &amp; Publish</Button>
      </CardContent>
    </Card>
  )
}

interface QuickAction { label: string; icon: typeof MapPin; href?: string }

const quickActions: QuickAction[] = [
  { label: "Add Location", icon: MapPin },
  { label: "Add Department", icon: Building2 },
  { label: "Add User", icon: Users, href: "/settings/users" },
  { label: "Upload Template", icon: FileUp },
  { label: "Notifications", icon: BellRing },
  { label: "Run Compliance", icon: ShieldCheck },
  { label: "View Audit History", icon: History, href: "/audit" },
  { label: "Import Settings", icon: FileInput },
]

export function QuickActionsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {quickActions.map((a) => (
            a.href ? (
              <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center hover:bg-surface-50">
                <a.icon className="h-4 w-4 text-surface-500" />
                <span className="text-xs font-medium text-surface-700">{a.label}</span>
              </Link>
            ) : (
              <button key={a.label} disabled title={NOT_WIRED} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center opacity-50 cursor-not-allowed">
                <a.icon className="h-4 w-4 text-surface-400" />
                <span className="text-xs font-medium text-surface-500">{a.label}</span>
              </button>
            )
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
