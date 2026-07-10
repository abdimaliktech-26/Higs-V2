import { getReportsData, type ReportsData } from "@/lib/actions/reports"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Progress } from "@/components/ui/progress"
import { Button } from "@/components/ui/button"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Dropdown } from "@/components/ui/dropdown"
import {
  BarChart3, Download, FileSpreadsheet, Printer, Filter, Sparkles, CalendarClock, History, MoreHorizontal,
} from "lucide-react"
import Link from "next/link"
import { reportTypes } from "./reports-report-types"
import { deriveOverviewMetrics } from "./reports-metrics"
import { ReportingOverviewHero, ReportingKpiRow } from "./reports-hero"
import { AiExecutiveAssistant, RecentReportsCard, ReportingPipelineCard, ScheduledReportsCard } from "./reports-sidebar"
import { PopularTemplates, Compliance245DGrid, QuickExport } from "./reports-templates"
import { AnalyticsDashboard } from "./reports-analytics"
import { ReportLibrary, ReportPreview, DhsAuditReadinessCard } from "./reports-library"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId: string; isSuperAdmin: boolean; report?: string; from?: string; to?: string }

export async function ReportsContent({ orgId, isSuperAdmin, report, from, to }: Props) {
  if (isSuperAdmin && !orgId) {
    return <div className="space-y-6">
      <PageHeader />
      <Card><CardContent className="py-16"><EmptyState title="Switch to an organization" description="Select an organization to view reports." icon={<BarChart3 className="h-8 w-8" />} /></CardContent></Card>
    </div>
  }

  let data: ReportsData
  try { data = await getReportsData(orgId, { from, to }) }
  catch (e) { return <ErrorState title="Error loading reports" description={(e as Error).message} /> }

  const activeReport = report || "dashboard"

  return (
    <div className="space-y-6">
      <PageHeader />

      <ReportTypeNav active={activeReport} from={from} to={to} />

      {activeReport === "dashboard" && <DashboardView data={data} from={from} to={to} />}
      {activeReport === "compliance" && <ComplianceReport data={data} />}
      {activeReport === "packets" && <PacketReport data={data} />}
      {activeReport === "validation" && <ValidationReport data={data} />}
      {activeReport === "staff" && <StaffReport data={data} />}
      {activeReport === "documents" && <DocumentReport data={data} />}
      {activeReport === "audit" && <AuditReport data={data} />}
    </div>
  )
}

// === HEADER ===
function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Reports</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">
          Monitor compliance, operations, staff performance, and organizational health through interactive reporting.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><Sparkles className="h-4 w-4" /> Generate Report</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><CalendarClock className="h-4 w-4" /> Schedule Report</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><History className="h-4 w-4" /> Report History</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[
            { value: "duplicate", label: "Duplicate Report Set", disabled: true },
            { value: "archive", label: "Archive", disabled: true },
            { value: "settings", label: "Report Settings", disabled: true },
          ]}
        />
      </div>
    </div>
  )
}

// === REPORT TYPE NAVIGATION (preserves existing ?report= routing) ===
function ReportTypeNav({ active, from, to }: { active: string; from?: string; to?: string }) {
  const qs = (id: string) => `/reports?report=${id}${from ? `&from=${from}` : ""}${to ? `&to=${to}` : ""}`
  const items = [{ id: "dashboard", label: "Dashboard" }, ...reportTypes.map((r) => ({ id: r.id, label: r.label }))]
  return (
    <div className="flex flex-wrap gap-2 border-b border-surface-200 pb-3">
      {items.map((item) => (
        <Link
          key={item.id}
          href={qs(item.id)}
          className={
            active === item.id
              ? "rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700"
              : "rounded-lg px-3 py-1.5 text-sm font-medium text-surface-500 hover:bg-surface-50 hover:text-surface-700"
          }
        >
          {item.label}
        </Link>
      ))}
    </div>
  )
}

// === DASHBOARD (matches approved Reports mockup) ===
function DashboardView({ data, from, to }: { data: ReportsData; from?: string; to?: string }) {
  const metrics = deriveOverviewMetrics(data)

  return (
    <>
      <form className="flex flex-wrap items-end gap-3">
        <Input label="From" name="from" type="date" defaultValue={from || ""} className="w-40" />
        <Input label="To" name="to" type="date" defaultValue={to || ""} className="w-40" />
        <Button type="submit" size="sm"><Filter className="h-4 w-4" /> Apply</Button>
        <Link href="/reports"><Button type="button" variant="ghost" size="sm">Clear</Button></Link>
      </form>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
        <ReportingOverviewHero metrics={metrics} />
        <ReportingKpiRow metrics={metrics} activeClients={data.clients.active} />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2.7fr)_minmax(0,1fr)]">
        <div className="space-y-6">
          <PopularTemplates />
          <AnalyticsDashboard data={data} metrics={metrics} />
          <ReportLibrary />
          <ReportPreview />
          <DhsAuditReadinessCard metrics={metrics} />
          <Compliance245DGrid />
          <QuickExport />
        </div>
        <div className="space-y-6">
          <AiExecutiveAssistant />
          <RecentReportsCard />
          <ReportingPipelineCard />
          <ScheduledReportsCard />
        </div>
      </div>
    </>
  )
}

// === COMPLIANCE READINESS REPORT ===
function ComplianceReport({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Compliance Readiness Summary</CardTitle><CardDescription>Overall compliance posture across all clients and packets</CardDescription></CardHeader><CardContent>
        <div className="grid gap-6 sm:grid-cols-3 mb-6">
          <div className="text-center p-4 rounded-lg bg-success-50 border border-success-100">
            <p className="text-3xl font-bold text-success-600">{data.clients.active}</p>
            <p className="text-sm text-success-700">Active Clients</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-brand-50 border border-brand-100">
            <p className="text-3xl font-bold text-brand-600">{data.packets.total}</p>
            <p className="text-sm text-brand-700">Total Packets</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-warning-50 border border-warning-100">
            <p className="text-3xl font-bold text-warning-600">{data.packets.overdue}</p>
            <p className="text-sm text-warning-700">Overdue</p>
          </div>
        </div>
        <div className="space-y-4">
          <div><p className="text-sm font-medium text-surface-700 mb-1">Average Validation Score</p><ScoreDisplay score={data.validations.avgScore} /></div>
          <div><p className="text-sm font-medium text-surface-700 mb-1">Document Completion</p><ScoreDisplay score={data.documents.total > 0 ? Math.round((data.documents.completed / data.documents.total) * 100) : 0} /></div>
          <div><p className="text-sm font-medium text-surface-700 mb-1">Signature Completion</p><ScoreDisplay score={data.signatures.total > 0 ? Math.round((data.signatures.completed / data.signatures.total) * 100) : 0} /></div>
          <div><p className="text-sm font-medium text-surface-700 mb-1">Approval Rate</p><ScoreDisplay score={data.approvals.total > 0 ? Math.round((data.approvals.approved / data.approvals.total) * 100) : 0} /></div>
        </div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Issues Breakdown</CardTitle></CardHeader><CardContent>
        <div className="grid grid-cols-2 gap-4">
          <div className="rounded-lg border p-4 text-center border-danger-200 bg-danger-50"><p className="text-3xl font-bold text-danger-600">{data.validations.criticalIssues}</p><p className="text-sm mt-1 text-danger-700">Critical Issues</p></div>
          <div className="rounded-lg border p-4 text-center border-warning-200 bg-warning-50"><p className="text-3xl font-bold text-warning-600">{data.validations.warningIssues}</p><p className="text-sm mt-1 text-warning-700">Warnings</p></div>
        </div>
      </CardContent></Card>
      <ExportSection />
    </div>
  )
}

// === PACKET COMPLETION REPORT ===
function PacketReport({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Packet Completion Summary</CardTitle></CardHeader><CardContent>
        <div className="grid gap-4 sm:grid-cols-3 mb-6">
          <div className="text-center p-4 rounded-lg bg-success-50 border border-success-100"><p className="text-3xl font-bold text-success-600">{data.packets.completed}</p><p className="text-sm mt-1 text-success-700">Completed</p></div>
          <div className="text-center p-4 rounded-lg bg-brand-50 border border-brand-100"><p className="text-3xl font-bold text-brand-600">{data.packets.total - data.packets.completed}</p><p className="text-sm mt-1 text-brand-700">In Progress</p></div>
          <div className="text-center p-4 rounded-lg bg-danger-50 border border-danger-100"><p className="text-3xl font-bold text-danger-600">{data.packets.overdue}</p><p className="text-sm mt-1 text-danger-700">Overdue</p></div>
        </div>
        <p className="text-sm font-medium text-surface-700 mb-3">By Status</p>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {Object.entries(data.packets.byStatus).sort().map(([s, c]) => (
            <div key={s} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
              <StatusChip status={s} size="sm" /><span className="text-lg font-bold text-surface-900">{c}</span>
            </div>
          ))}
        </div>
      </CardContent></Card>
      <Card><CardHeader><CardTitle>By Packet Type</CardTitle></CardHeader><CardContent>
        <div className="grid gap-2">
          {Object.entries(data.packets.byType).sort().map(([t, c]) => (
            <div key={t} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
              <span className="text-sm font-medium text-surface-900 capitalize">{t.replace(/_/g, " ")}</span>
              <div className="flex items-center gap-3">
                <Progress value={data.packets.total > 0 ? Math.round((c / data.packets.total) * 100) : 0} size="sm" className="w-24" />
                <span className="text-sm font-bold text-surface-700">{c}</span>
              </div>
            </div>
          ))}
        </div>
      </CardContent></Card>
      <ExportSection />
    </div>
  )
}

// === VALIDATION ISSUES REPORT ===
function ValidationReport({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Validation Overview</CardTitle><CardDescription>{data.validations.total} total validation runs</CardDescription></CardHeader><CardContent>
        <div className="mb-6">
          <p className="text-sm font-medium text-surface-700 mb-1">Average Compliance Score</p>
          <ScoreDisplay score={data.validations.avgScore} />
        </div>
        <div className="grid grid-cols-3 gap-4">
          <div className="text-center p-4 rounded-lg bg-danger-50 border border-danger-100"><p className="text-3xl font-bold text-danger-600">{data.validations.criticalIssues}</p><p className="text-sm mt-1 text-danger-700">Critical</p></div>
          <div className="text-center p-4 rounded-lg bg-warning-50 border border-warning-100"><p className="text-3xl font-bold text-warning-600">{data.validations.warningIssues}</p><p className="text-sm mt-1 text-warning-700">Warnings</p></div>
          <div className="text-center p-4 rounded-lg bg-success-50 border border-success-100"><p className="text-3xl font-bold text-success-600">{data.validations.total > 0 ? Math.round(data.validations.avgScore) : 0}%</p><p className="text-sm mt-1 text-success-700">Avg Score</p></div>
        </div>
      </CardContent></Card>
      <ExportSection />
    </div>
  )
}

// === STAFF ACTIVITY REPORT ===
function StaffReport({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Staff Activity (Last 30 Days)</CardTitle><CardDescription>Actions performed by team members</CardDescription></CardHeader><CardContent>
        {data.staffActivity.length === 0 ? (
          <div className="py-8 text-center"><p className="text-sm text-surface-500">No staff activity recorded in the last 30 days</p></div>
        ) : (
          <div className="space-y-3">
            {data.staffActivity.map((s, i) => {
              const maxCount = Math.max(...data.staffActivity.map(x => x.eventCount), 1)
              return (
                <div key={s.userId} className="flex items-center gap-4">
                  <span className="w-6 text-center text-sm font-bold text-surface-400">{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-surface-900 truncate">{s.userName}</p>
                    <Progress value={Math.round((s.eventCount / maxCount) * 100)} size="sm" variant="default" />
                  </div>
                  <span className="text-sm font-bold text-surface-700 w-12 text-right">{s.eventCount}</span>
                </div>
              )
            })}
          </div>
        )}
      </CardContent></Card>
      <Card><CardHeader><CardTitle>Staff Summary</CardTitle></CardHeader><CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="text-center p-4 rounded-lg bg-brand-50 border border-brand-100">
            <p className="text-3xl font-bold text-brand-600">{data.staffActivity.length}</p>
            <p className="text-sm mt-1 text-brand-700">Active Staff (30d)</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100">
            <p className="text-3xl font-bold text-surface-600">{String(data.reportSpecific.memberCount ?? "—")}</p>
            <p className="text-sm mt-1 text-surface-700">Total Members</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-success-50 border border-success-100">
            <p className="text-3xl font-bold text-success-600">{data.staffActivity.reduce((s, a) => s + a.eventCount, 0)}</p>
            <p className="text-sm mt-1 text-success-700">Total Actions</p>
          </div>
        </div>
      </CardContent></Card>
      <ExportSection />
    </div>
  )
}

// === DOCUMENT LIBRARY REPORT ===
function DocumentReport({ data }: { data: ReportsData }) {
  const total = data.documents.total + (data.reportSpecific.supportingDocs as number || 0)
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Document Library Summary</CardTitle><CardDescription>{total} total documents</CardDescription></CardHeader><CardContent>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-6">
          <div className="text-center p-4 rounded-lg bg-brand-50 border border-brand-100"><p className="text-3xl font-bold text-brand-600">{data.documents.completed}</p><p className="text-sm mt-1 text-brand-700">Completed</p></div>
          <div className="text-center p-4 rounded-lg bg-warning-50 border border-warning-100"><p className="text-3xl font-bold text-warning-600">{data.documents.inProgress}</p><p className="text-sm mt-1 text-warning-700">In Progress</p></div>
          <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100"><p className="text-3xl font-bold text-surface-600">{data.documents.pending}</p><p className="text-sm mt-1 text-surface-700">Pending</p></div>
          <div className="text-center p-4 rounded-lg bg-violet-50 border border-violet-100"><p className="text-3xl font-bold text-violet-600">{(data.reportSpecific.supportingDocs as number) || 0}</p><p className="text-sm mt-1 text-violet-700">Supporting</p></div>
        </div>
        <DocBar label="Completed" count={data.documents.completed} total={data.documents.total} variant="success" />
        <DocBar label="In Progress" count={data.documents.inProgress} total={data.documents.total} variant="warning" />
        <DocBar label="Pending" count={data.documents.pending} total={data.documents.total} variant="default" />
      </CardContent></Card>
      <ExportSection />
    </div>
  )
}

// === AUDIT SUMMARY REPORT ===
function AuditReport({ data }: { data: ReportsData }) {
  return (
    <div className="space-y-6">
      <Card><CardHeader><CardTitle>Audit Activity Summary</CardTitle><CardDescription>Overview of system-wide audit events</CardDescription></CardHeader><CardContent>
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="text-center p-4 rounded-lg bg-brand-50 border border-brand-100">
            <p className="text-3xl font-bold text-brand-600">{data.staffActivity.reduce((s, a) => s + a.eventCount, 0)}</p>
            <p className="text-sm mt-1 text-brand-700">Events (30d)</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-success-50 border border-success-100">
            <p className="text-3xl font-bold text-success-600">{data.staffActivity.length}</p>
            <p className="text-sm mt-1 text-success-700">Active Users</p>
          </div>
          <div className="text-center p-4 rounded-lg bg-surface-50 border border-surface-100">
            <p className="text-3xl font-bold text-surface-600">{data.packets.total + data.signatures.total + data.approvals.total + data.validations.total}</p>
            <p className="text-sm mt-1 text-surface-700">Workflow Actions</p>
          </div>
        </div>
        <Separator className="my-4" />
        <div className="space-y-2 text-sm text-surface-600">
          <div className="flex justify-between"><span>Client Changes</span><span className="font-medium text-surface-900">{data.clients.active + data.clients.archived}</span></div>
          <div className="flex justify-between"><span>Packet Status Changes</span><span className="font-medium text-surface-900">{data.packets.total}</span></div>
          <div className="flex justify-between"><span>Signature Events</span><span className="font-medium text-surface-900">{data.signatures.total}</span></div>
          <div className="flex justify-between"><span>Approval Decisions</span><span className="font-medium text-surface-900">{data.approvals.total}</span></div>
          <div className="flex justify-between"><span>Validation Runs</span><span className="font-medium text-surface-900">{data.validations.total}</span></div>
        </div>
      </CardContent></Card>
      <ExportSection />
    </div>
  )
}

// === SHARED COMPONENTS ===
const ScoreDisplay = ({ score }: { score: number }) => (
  <div className="flex items-center gap-3">
    <Progress value={score} size="md" variant={score >= 80 ? "success" : score >= 50 ? "warning" : "danger"} className="flex-1" />
    <span className={`text-sm font-bold min-w-[3ch] ${score >= 80 ? "text-success-600" : score >= 50 ? "text-warning-600" : "text-danger-600"}`}>{score}%</span>
  </div>
)

function DocBar({ label, count, total, variant }: { label: string; count: number; total: number; variant: "success" | "warning" | "default" }) {
  const p = total > 0 ? Math.round((count / total) * 100) : 0
  return (<div className="mb-2"><div className="flex justify-between text-sm mb-1"><span className="text-surface-600">{label}</span><span className="font-medium text-surface-900">{count} ({p}%)</span></div><Progress value={p} size="sm" variant={variant} /></div>)
}

function ExportSection() {
  return (<Card><CardHeader><CardTitle>Export</CardTitle><CardDescription>Download report data</CardDescription></CardHeader><CardContent className="flex gap-2">
    <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export CSV</Button>
    <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Printer className="h-4 w-4" /> Print</Button>
    <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><FileSpreadsheet className="h-4 w-4" /> Export PDF</Button>
  </CardContent></Card>)
}
