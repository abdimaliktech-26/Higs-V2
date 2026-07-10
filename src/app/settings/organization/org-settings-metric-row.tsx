import { CalendarClock, CalendarCheck2, BadgeAlert, FileStack, FileText, HardDrive, Users, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { OrgConfigMetrics } from "./org-settings-metrics"

interface MetricCardProps {
  icon: LucideIcon
  label: string
  value: string | number
  caption?: string
}

function MetricCard({ icon: Icon, label, value, caption }: MetricCardProps) {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-surface-400">
          <Icon className="h-4 w-4" />
          <p className="text-xs font-medium">{label}</p>
        </div>
        <p className="mt-2 text-xl font-bold text-surface-900">{value}</p>
        {caption && <p className="text-xs text-surface-400">{caption}</p>}
      </CardContent>
    </Card>
  )
}

export function OrgSettingsMetricRow({ metrics }: { metrics: OrgConfigMetrics }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      <MetricCard icon={CalendarClock} label="Next Annual Reviews" value="—" />
      <MetricCard icon={CalendarCheck2} label="45-Day Reviews Due" value="—" />
      <MetricCard icon={BadgeAlert} label="Expiring Certifications" value="—" />
      <MetricCard icon={FileStack} label="DHS Forms Configured" value="—" />
      <MetricCard icon={FileText} label="Default Intake Packet" value={metrics.defaultPacketType ? metrics.defaultPacketType : "Not set"} />
      <MetricCard icon={HardDrive} label="Storage Forecast" value="—" />
      <MetricCard icon={Users} label="License Utilization" value={metrics.licensedUsersCount} caption="licensed users" />
    </div>
  )
}
