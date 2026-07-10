import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { MousePointerClick } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import type { getValidationRules } from "@/lib/actions/validation"

type RuleRow = Awaited<ReturnType<typeof getValidationRules>>[number]

const severityVariant: Record<string, "danger" | "warning" | "secondary"> = { critical: "danger", warning: "warning", info: "secondary" }

export function RuleDetailPanel({ rule }: { rule: RuleRow | null }) {
  if (!rule) {
    return (
      <Card>
        <CardContent className="py-16">
          <EmptyState icon={<MousePointerClick className="h-8 w-8" />} title="Select a rule" description="Choose a rule from the library to see its details here." />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Badge variant={severityVariant[rule.severity] || "secondary"} size="sm">{rule.severity}</Badge>
          <Badge variant={rule.active ? "success" : "secondary"} size="sm">{rule.active ? "Active" : "Inactive"}</Badge>
        </div>
        <CardTitle className="mt-2">{rule.name}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-surface-600">{rule.description || "No description provided."}</p>
        <div className="grid grid-cols-2 gap-3 border-t border-surface-100 pt-3">
          <Row label="Category" value={rule.category.replace(/_/g, " ")} />
          <Row label="Program" value={rule.program || "—"} />
          <Row label="Packet Type" value={rule.packetType?.replace(/_/g, " ") || "—"} />
          <Row label="Created" value={formatDateTime(rule.createdAt)} />
          <Row label="Last Updated" value={formatDateTime(rule.updatedAt)} />
        </div>
      </CardContent>
    </Card>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-surface-500">{label}</p>
      <p className="mt-0.5 truncate font-medium capitalize text-surface-900">{value}</p>
    </div>
  )
}
