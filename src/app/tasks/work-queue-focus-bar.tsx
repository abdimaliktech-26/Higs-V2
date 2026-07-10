import { CalendarClock, PenSquare, BadgeAlert, ShieldAlert, UserX } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import type { OperationalFocus } from "./work-queue-metrics"

export function OperationalFocusBar({ focus }: { focus: OperationalFocus }) {
  const items = [
    { icon: CalendarClock, label: "Annual Reviews Due", value: focus.annualReviewsDue, available: true },
    { icon: PenSquare, label: "Signature Blockers", value: focus.signatureBlockers, available: true },
    { icon: BadgeAlert, label: "Expiring Certifications", value: focus.expiringCertifications, available: focus.expiringCertifications !== null },
    { icon: ShieldAlert, label: "Validation Issues", value: focus.validationIssues, available: true },
    { icon: UserX, label: "High Risk Clients", value: focus.highRiskClients, available: focus.highRiskClients !== null },
  ]

  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-6 p-4">
        {items.map((i) => (
          <div key={i.label} className="flex items-center gap-2">
            <i.icon className={`h-4 w-4 ${i.available ? "text-danger-500" : "text-surface-300"}`} />
            <span className="text-xs text-surface-500">{i.label}</span>
            <span className={`text-sm font-bold ${i.available ? "text-surface-900" : "text-surface-300"}`}>{i.available ? i.value : "—"}</span>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}
