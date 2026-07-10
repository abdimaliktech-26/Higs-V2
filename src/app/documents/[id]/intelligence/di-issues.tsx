import { resolveValidationIssue } from "@/lib/actions/validation"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { AlertTriangle, Info, CheckCircle2 } from "lucide-react"
import type { PartitionedIssues } from "./di-metrics"

type IssueRow = PartitionedIssues["issues"][number]

const severityVariant: Record<string, "danger" | "warning" | "secondary"> = { critical: "danger", warning: "warning", info: "secondary" }

function IssueList({ items, emptyLabel }: { items: IssueRow[]; emptyLabel: string }) {
  if (items.length === 0) {
    return <p className="py-4 text-center text-xs text-surface-400">{emptyLabel}</p>
  }
  return (
    <ul className="space-y-2.5">
      {items.map((issue) => (
        <li key={issue.id} className="flex items-start justify-between gap-3 rounded-lg border border-surface-100 p-3">
          <div className="flex min-w-0 items-start gap-2">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-surface-400" />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-surface-900">{issue.message}</p>
              {issue.fieldName && <p className="text-xs text-surface-400">Field: {issue.fieldName}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Badge variant={severityVariant[issue.severity] || "secondary"} size="sm">{issue.severity}</Badge>
            {issue.status === "open" ? (
              <form action={async () => { "use server"; await resolveValidationIssue(issue.id) }}>
                <Button type="submit" variant="ghost" size="icon-sm" title="Mark resolved"><CheckCircle2 className="h-4 w-4 text-surface-400" /></Button>
              </form>
            ) : (
              <CheckCircle2 className="h-4 w-4 text-success-500" />
            )}
          </div>
        </li>
      ))}
    </ul>
  )
}

export function IssuesDetectedCard({ issues }: { issues: IssueRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Issues Detected ({issues.length})</CardTitle></CardHeader>
      <CardContent><IssueList items={issues} emptyLabel="No issues detected." /></CardContent>
    </Card>
  )
}

export function MissingInformationCard({ items }: { items: IssueRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Missing Information ({items.length})</CardTitle></CardHeader>
      <CardContent><IssueList items={items} emptyLabel="No missing required fields." /></CardContent>
    </Card>
  )
}

export function WarningsCard({ warnings }: { warnings: IssueRow[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>Warnings ({warnings.length})</CardTitle></CardHeader>
      <CardContent><IssueList items={warnings} emptyLabel="No warnings." /></CardContent>
    </Card>
  )
}

export function NoValidationYetCard() {
  return (
    <Card>
      <CardContent className="py-10">
        <EmptyState icon={<Info className="h-6 w-6" />} title="No validation run yet" description="Run validation on this packet from the Validation Center to see issues, missing information, and warnings here." />
      </CardContent>
    </Card>
  )
}
