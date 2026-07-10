import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { PDFViewerPlaceholder } from "@/components/ui/pdf-controls"
import { EmptyState } from "@/components/ui/states"
import { readinessLabel, type ReportsOverviewMetrics } from "./reports-metrics"

export function ReportLibrary() {
  return (
    <Card>
      <CardHeader><CardTitle>Report Library</CardTitle></CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200">
                {["Report", "Category", "Owner", "Created", "Status", "Format", "Version"].map((header) => (
                  <th key={header} className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500 last:pr-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td colSpan={7} className="py-10">
                  <EmptyState
                    title="No reports generated yet"
                    description="Generated reports will appear here with category, owner, status, format, and version."
                  />
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function ReportPreview() {
  return (
    <Card id="report-preview">
      <CardHeader><CardTitle>Report Preview</CardTitle></CardHeader>
      <CardContent>
        <PDFViewerPlaceholder fileName="Select a report to preview" />
      </CardContent>
    </Card>
  )
}

export function DhsAuditReadinessCard({ metrics }: { metrics: ReportsOverviewMetrics }) {
  return (
    <Card>
      <CardHeader><CardTitle>DHS Audit Readiness</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-3">
          <p className="text-2xl font-bold text-surface-900">{metrics.auditReadinessPct}%</p>
          <span className="text-sm text-surface-500">{readinessLabel(metrics.auditReadinessPct)}</span>
        </div>
        <Progress value={metrics.auditReadinessPct} size="sm" variant={metrics.auditReadinessPct >= 80 ? "success" : "warning"} className="mb-4" />
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-surface-500">Pages</p><p className="font-medium text-surface-900">—</p></div>
          <div><p className="text-surface-500">Created by</p><p className="font-medium text-surface-900">—</p></div>
        </div>
        <div className="mt-4 flex gap-2">
          <Link href="/reports?report=compliance" className="flex-1"><Button variant="primary" size="sm" fullWidth>Generate</Button></Link>
          <a href="#report-preview" className="flex-1"><Button variant="secondary" size="sm" fullWidth>Preview</Button></a>
        </div>
      </CardContent>
    </Card>
  )
}
