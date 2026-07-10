import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { AlertTriangle, FileEdit, PenSquare, CheckCircle2, PartyPopper } from "lucide-react"
import type { PriorityItem } from "./packet-overview-metrics"

const kindIcon = {
  validation: AlertTriangle,
  document: FileEdit,
  signature: PenSquare,
  approval_ready: CheckCircle2,
  ready: PartyPopper,
} as const

const kindTone = {
  validation: "danger",
  document: "warning",
  signature: "warning",
  approval_ready: "success",
  ready: "success",
} as const

const kindIconBg: Record<PriorityItem["kind"], string> = {
  validation: "bg-danger-50 text-danger-600",
  document: "bg-warning-50 text-warning-600",
  signature: "bg-warning-50 text-warning-600",
  approval_ready: "bg-success-50 text-success-600",
  ready: "bg-success-50 text-success-600",
}

export function PacketPriorityCard({ item }: { item: PriorityItem }) {
  const Icon = kindIcon[item.kind]
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Continue Here</CardTitle>
        <Badge variant={kindTone[item.kind]} size="sm">{item.kind === "ready" || item.kind === "approval_ready" ? "On Track" : "Needs Attention"}</Badge>
      </CardHeader>
      <CardContent>
        <div className="flex items-start gap-3">
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${kindIconBg[item.kind]}`}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-surface-900">{item.title}</p>
            <p className="mt-1 text-sm text-surface-500">{item.description}</p>
          </div>
        </div>
        <Link href={item.ctaHref}>
          <Button variant="primary" size="sm" fullWidth className="mt-4">{item.ctaLabel}</Button>
        </Link>
      </CardContent>
    </Card>
  )
}
