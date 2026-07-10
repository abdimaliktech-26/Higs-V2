import { Bell, AlertTriangle, CheckSquare, PenSquare, AtSign, Sparkles, Shield, type LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Sparkline } from "@/components/ui/charts"
import type { KpiDef } from "./notifications-metrics"

const icons: Record<string, LucideIcon> = {
  unread: Bell,
  critical: AlertTriangle,
  pending_approval: CheckSquare,
  pending_signature: PenSquare,
  mentions: AtSign,
  ai: Sparkles,
  system: Shield,
}

const strokes: Record<string, string> = {
  unread: "#3b82f6",
  critical: "#ef4444",
  pending_approval: "#f59e0b",
  pending_signature: "#8b5cf6",
  mentions: "#0ea5e9",
  ai: "#10b981",
  system: "#ef4444",
}

export function NotificationsKpiRow({ kpis }: { kpis: KpiDef[] }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
      {kpis.map((k) => {
        const Icon = icons[k.key] || Bell
        const stroke = strokes[k.key] || "#3b82f6"
        return (
          <Card key={k.key}>
            <CardContent className="p-4">
              <div className="flex items-center gap-2 text-surface-500">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-surface-100">
                  <Icon className="h-3.5 w-3.5" style={{ color: stroke }} />
                </div>
                <p className="text-xs font-medium">{k.label}</p>
              </div>
              <p className="mt-2 text-2xl font-bold text-surface-900">{k.value}</p>
              <Sparkline points={k.trend} height={40} stroke={stroke} fill="transparent" className="mt-2" />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
