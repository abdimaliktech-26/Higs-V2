import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { CheckCircle2, XCircle } from "lucide-react"

interface ChecklistRow { label: string; available: boolean }

const rows: ChecklistRow[] = [
  { label: "Client creation available", available: true },
  { label: "Packet creation available", available: true },
  { label: "Document upload available", available: true },
  { label: "Validation available", available: true },
  { label: "Audit logging available", available: true },
  { label: "Bulk import unavailable", available: false },
  { label: "Duplicate detection unavailable", available: false },
  { label: "Rollback unavailable", available: false },
  { label: "OCR unavailable", available: false },
]

export function ReadinessChecklistCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Data Readiness Checklist</CardTitle></CardHeader>
      <CardContent>
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-2.5 text-sm">
              {r.available ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success-500" /> : <XCircle className="h-4 w-4 shrink-0 text-surface-300" />}
              <span className={r.available ? "text-surface-700" : "text-surface-400"}>{r.label}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
