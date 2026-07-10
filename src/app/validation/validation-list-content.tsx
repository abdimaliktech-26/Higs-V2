import { getValidationResults, getValidationRules } from "@/lib/actions/validation"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ShieldCheck, AlertTriangle, AlertCircle, Info, ChevronLeft, ChevronRight, Scale } from "lucide-react"
import { formatDateTime } from "@/lib/utils"
import Link from "next/link"

interface Props { orgId: string; page: number }

export async function ValidationListContent({ orgId, page }: Props) {
  let data: Awaited<ReturnType<typeof getValidationResults>>
  let rules: Awaited<ReturnType<typeof getValidationRules>>
  try {
    [data, rules] = await Promise.all([
      getValidationResults(orgId, { page, pageSize: 20 }),
      getValidationRules(orgId, { active: true }),
    ])
  } catch (e) {
    return <ErrorState title="Error loading validation data" description={(e as Error).message} />
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Validation Center</h1>
          <p className="mt-1 text-sm text-surface-500">Compliance validation results across packets and documents</p>
        </div>
      </div>

      {/* Rules summary */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50">
              <Scale className="h-6 w-6 text-brand-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{rules.length}</p>
              <p className="text-xs text-surface-500">Active Rules</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center gap-4 p-5">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success-50">
              <ShieldCheck className="h-6 w-6 text-success-600" />
            </div>
            <div>
              <p className="text-2xl font-bold text-surface-900">{data.total}</p>
              <p className="text-xs text-surface-500">Validation Runs</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Validation Results</CardTitle>
          <CardDescription>Packet and document compliance check results</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {data.results.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState title="No validation results yet" description="Run validation from a packet's overview page to see results here" icon={<ShieldCheck className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Packet</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Score</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Issues</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Ran By</th>
                    <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Date</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {data.results.map((r) => (
                    <tr key={r.id} className="hover:bg-surface-50 transition-colors cursor-pointer" onClick={() => window.location.href = `/validation/${r.id}`}>
                      <td className="py-3 pl-6 pr-4 font-medium text-surface-900">
                        {r.packet?.client.firstName} {r.packet?.client.lastName}
                      </td>
                      <td className="py-3 pr-4 capitalize text-surface-700">{r.packet?.packetType.replace(/_/g, " ")}</td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-2">
                          <Progress value={r.score} size="sm" variant={r.score >= 80 ? "success" : r.score >= 50 ? "warning" : "danger"} className="w-20" />
                          <span className={`text-xs font-medium ${r.score >= 80 ? "text-success-700" : r.score >= 50 ? "text-warning-700" : "text-danger-700"}`}>
                            {r.score}%
                          </span>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <div className="flex items-center gap-1.5">
                          {r.criticalCount > 0 && <Badge variant="danger" size="sm">{r.criticalCount}</Badge>}
                          {r.warningCount > 0 && <Badge variant="warning" size="sm">{r.warningCount}</Badge>}
                          {r.infoCount > 0 && <Badge variant="default" size="sm">{r.infoCount}</Badge>}
                          {r.totalIssues === 0 && <span className="text-xs text-success-600">Clear</span>}
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-surface-500">{r.ranBy.name}</td>
                      <td className="py-3 pr-6 text-xs text-surface-500">{formatDateTime(r.ranAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {data.totalPages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-surface-500">Page {data.page} of {data.totalPages}</p>
          <div className="flex gap-2">
            <Link href={`/validation?page=${page - 1}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page <= 1 ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              <ChevronLeft className="h-4 w-4" /> Previous
            </Link>
            <Link href={`/validation?page=${page + 1}`} className={`inline-flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-medium ${page >= data.totalPages ? "text-surface-300 pointer-events-none" : "text-surface-600 hover:bg-surface-100"}`}>
              Next <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
