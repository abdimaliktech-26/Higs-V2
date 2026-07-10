import { Building2, Activity, Users, UserCircle, Sparkles, DollarSign, Gauge, LifeBuoy, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { PlatformKpis } from "./super-admin-metrics"

interface KpiDef { icon: LucideIcon; label: string; value: string; available: boolean }

export function SuperAdminKpiRow({ kpis }: { kpis: PlatformKpis }) {
  const cards: KpiDef[] = [
    { icon: Building2, label: "Total Organizations", value: String(kpis.totalOrganizations), available: true },
    { icon: Activity, label: "Active Organizations", value: String(kpis.activeOrganizations), available: true },
    { icon: Users, label: "Total Users", value: String(kpis.totalUsers), available: true },
    { icon: UserCircle, label: "Total Clients", value: String(kpis.totalClients), available: true },
    { icon: Sparkles, label: "AI Requests Today", value: String(kpis.aiRequestsToday), available: true },
    { icon: DollarSign, label: "Monthly Recurring Revenue", value: "—", available: false },
    { icon: Gauge, label: "Platform Uptime", value: "—", available: false },
    { icon: LifeBuoy, label: "Active Support Cases", value: "—", available: false },
  ]

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
      {cards.map((c) => (
        <Card key={c.label}>
          <CardContent className="p-4">
            <div className="flex items-center gap-2 text-surface-500">
              <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-100">
                <c.icon className="h-3.5 w-3.5" />
              </div>
              <p className="text-xs font-medium">{c.label}</p>
            </div>
            <p className={`mt-2 text-2xl font-bold ${c.available ? "text-surface-900" : "text-surface-300"}`}>{c.value}</p>
            {!c.available && <p className="mt-1 text-[11px] text-surface-400">Coming soon</p>}
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
