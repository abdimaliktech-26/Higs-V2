import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import { ShieldCheck } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import type { getValidationResults } from "@/lib/actions/validation"

type ResultRow = Awaited<ReturnType<typeof getValidationResults>>["results"][number]

export function RecentValidationOutcomesCard({ results }: { results: ResultRow[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Recent Validation Outcomes</CardTitle>
        <Link href="/validation" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>
      </CardHeader>
      <CardContent>
        {results.length === 0 ? (
          <EmptyState className="py-8" icon={<ShieldCheck className="h-6 w-6" />} title="No validation runs yet" description="Run validation from a packet's overview page to see outcomes here." />
        ) : (
          <ul className="space-y-2.5">
            {results.slice(0, 8).map((r) => (
              <li key={r.id} className="flex items-center gap-3 text-sm">
                <div className="min-w-0 flex-1">
                  <Link href={`/validation/${r.id}`} className="truncate font-medium text-surface-900 hover:text-brand-700 hover:underline">
                    {r.packet ? `${r.packet.client.firstName} ${r.packet.client.lastName}` : "Unknown client"}
                  </Link>
                  <p className="truncate text-xs text-surface-400 capitalize">{r.packet?.packetType.replace(/_/g, " ") || "—"} · {formatDateTime(r.ranAt)}</p>
                </div>
                <Progress value={r.score} size="sm" variant={r.score >= 80 ? "success" : r.score >= 50 ? "warning" : "danger"} className="w-16" />
                {r.criticalCount > 0 && <Badge variant="danger" size="sm">{r.criticalCount}</Badge>}
                {r.criticalCount === 0 && <Badge variant="success" size="sm">Clear</Badge>}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
