import Link from "next/link"
import { getPackets } from "@/lib/actions/templates"
import { getSignatureRequests } from "@/lib/actions/signatures"
import { getApprovalRequests } from "@/lib/actions/approvals"
import { getValidationResults } from "@/lib/actions/validation"
import { getAuditDashboardSummary } from "@/lib/actions/audit"
import { getAiRecommendations } from "@/lib/actions/ai"
import { getOrgUsers } from "@/lib/actions/users"
import { getUpcomingDeadlines } from "@/app/notifications/notifications-data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Sparkline } from "@/components/ui/charts"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Progress } from "@/components/ui/progress"
import { cn, formatDate, readinessLabel } from "@/lib/utils"
import {
  Activity,
  AlertTriangle,
  BadgeCheck,
  BarChart3,
  Bell,
  Bot,
  CalendarCheck2,
  CalendarDays,
  CalendarPlus,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  ClipboardCheck,
  Clock,
  Download,
  FileCheck2,
  FileSignature,
  FileText,
  Filter,
  Link as LinkIcon,
  ListChecks,
  Lock,
  MessageCircle,
  MoreHorizontal,
  ExternalLink,
  Plus,
  Printer,
  RefreshCcw,
  Search,
  Send,
  Settings2,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Upload,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react"

const NOT_WIRED = "Not part of this presentation pass - no backend source yet"

type PacketRow = Awaited<ReturnType<typeof getPackets>>["packets"][number]
type SignatureRow = Awaited<ReturnType<typeof getSignatureRequests>>["requests"][number]
type ApprovalRow = Awaited<ReturnType<typeof getApprovalRequests>>["requests"][number]
type ValidationRow = Awaited<ReturnType<typeof getValidationResults>>["results"][number]
type MemberRow = Awaited<ReturnType<typeof getOrgUsers>>[number]
type AiRecommendation = Awaited<ReturnType<typeof getAiRecommendations>>[number]
type UpcomingDeadline = Awaited<ReturnType<typeof getUpcomingDeadlines>>[number]

type EventKind = "review" | "signature" | "validation" | "approval" | "audit" | "task" | "overdue"
type EventPriority = "High" | "Medium" | "Low"

interface CalendarEvent {
  id: string
  kind: EventKind
  title: string
  subtitle: string
  date: Date
  status: string
  priority: EventPriority
  clientName?: string
  assigneeName?: string | null
  packetId?: string | null
  packetType?: string | null
  href?: string
}

interface CalendarKpi {
  label: string
  value: string
  helper: string
  icon: LucideIcon
  tone: "brand" | "success" | "danger" | "purple" | "teal" | "amber" | "navy"
  points: number[]
  disabled?: boolean
}

interface Props {
  orgId: string
}

export async function CalendarContent({ orgId }: Props) {
  let packetsRes: Awaited<ReturnType<typeof getPackets>>
  let signaturesRes: Awaited<ReturnType<typeof getSignatureRequests>>
  let approvalsRes: Awaited<ReturnType<typeof getApprovalRequests>>
  let validationsRes: Awaited<ReturnType<typeof getValidationResults>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let aiRecs: Awaited<ReturnType<typeof getAiRecommendations>>
  let members: Awaited<ReturnType<typeof getOrgUsers>>
  let upcomingDeadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>

  try {
    [packetsRes, signaturesRes, approvalsRes, validationsRes, auditSummary, aiRecs, members, upcomingDeadlines] = await Promise.all([
      getPackets(orgId, { pageSize: 100 }),
      getSignatureRequests(orgId, { pageSize: 100 }),
      getApprovalRequests(orgId, { pageSize: 100 }),
      getValidationResults(orgId, { pageSize: 100 }),
      getAuditDashboardSummary(orgId),
      getAiRecommendations(orgId, { status: "open" }),
      getOrgUsers(orgId),
      getUpcomingDeadlines(orgId, 30),
    ])
  } catch (e) {
    return <ErrorState title="Error loading compliance calendar" description={(e as Error).message} />
  }

  const packets = packetsRes.packets
  const signatures = signaturesRes.requests
  const approvals = approvalsRes.requests
  const validations = validationsRes.results
  const events = buildCalendarEvents(packets, signatures, approvals, validations)
  const displayDate = pickDisplayDate(events)
  const monthDays = buildMonthDays(displayDate)
  const monthEvents = events.filter((event) => isSameMonth(event.date, displayDate))
  const focusedEvent = chooseFocusedEvent(events, displayDate)
  const kpis = buildKpis(packets, signatures, validations, approvals, aiRecs)
  const workload = deriveWorkload(packets, members)
  const timeline = deriveTimeline(packets, signatures, approvals, validations)
  const analytics = deriveAnalytics(packets, signatures, auditSummary.auditReadinessScore)

  return (
    <div className="space-y-4 pb-3">
      <CalendarHeader />
      <KpiStrip kpis={kpis} />

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_210px]">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_290px_390px]">
            <CalendarWorkspace displayDate={displayDate} monthDays={monthDays} events={monthEvents} />
            <UpcomingAgenda events={events} displayDate={displayDate} />
            <EventInspector event={focusedEvent} />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_1.15fr_1fr_0.8fr_0.95fr]">
            <WorkloadOverview workload={workload} />
            <ComplianceTimeline stages={timeline} />
            <DeadlinesCard deadlines={upcomingDeadlines} events={events} />
            <CalendarAnalytics analytics={analytics} />
            <QuickActions />
          </div>
        </div>

        <CalendarAiSidebar recommendations={aiRecs} members={members} />
      </div>
    </div>
  )
}

function CalendarHeader() {
  return (
    <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-[22px] font-bold tracking-tight text-surface-950">Compliance Calendar &amp; Scheduler</h1>
          <Star className="h-4 w-4 text-brand-600" />
        </div>
        <p className="mt-1 text-xs font-medium text-navy-600">
          Plan, monitor, and manage compliance schedules, reviews, deadlines, certifications, and operational workload.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled title={NOT_WIRED}><Plus className="h-4 w-4" /> Create Event</Button>
        <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><CalendarPlus className="h-4 w-4" /> Schedule Review</Button>
        <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><Upload className="h-4 w-4" /> Export Calendar</Button>
        <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><Printer className="h-4 w-4" /> Print Schedule</Button>
        <Button size="icon-sm" variant="secondary" disabled title={NOT_WIRED}><MoreHorizontal className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}

function KpiStrip({ kpis }: { kpis: CalendarKpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 2xl:grid-cols-9">
      {kpis.map((kpi) => {
        const Icon = kpi.icon
        return (
          <Card key={kpi.label} className={cn("min-h-[132px] overflow-hidden rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]", kpi.disabled && "opacity-75")}>
            <CardContent className="p-4">
              <div className="flex items-start gap-2">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", kpiTone(kpi.tone).iconBg)}>
                  <Icon className={cn("h-4 w-4", kpiTone(kpi.tone).icon)} />
                </span>
                <p className="min-h-8 flex-1 text-[11px] font-semibold leading-4 text-navy-900">{kpi.label}</p>
              </div>
              <div className="mt-3 flex items-end justify-between gap-2">
                <span className="text-[28px] font-bold leading-none text-navy-950">{kpi.value}</span>
                <span className={cn("text-[10px] font-semibold", kpi.disabled ? "text-surface-400" : kpiTone(kpi.tone).text)}>{kpi.helper}</span>
              </div>
              <Sparkline
                points={kpi.points}
                height={34}
                stroke={kpiTone(kpi.tone).stroke}
                fill={kpiTone(kpi.tone).fill}
                className="mt-3"
              />
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}

function CalendarWorkspace({ displayDate, monthDays, events }: { displayDate: Date; monthDays: Date[]; events: CalendarEvent[] }) {
  const title = displayDate.toLocaleDateString("en-US", { month: "long", year: "numeric" })

  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardContent className="p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-200 px-4 py-3">
          <div className="flex flex-wrap items-center gap-5 text-xs font-semibold text-surface-500">
            {["Month", "Week", "Day", "Agenda", "Timeline", "Workload"].map((tab, index) => (
              <span key={tab} className={cn("pb-2", index === 0 ? "border-b-2 border-brand-600 text-brand-700" : "text-surface-500")}>{tab}</span>
            ))}
          </div>
          <div className="flex items-center gap-2">
            <Button size="icon-sm" variant="secondary" disabled title={NOT_WIRED}><ChevronLeft className="h-4 w-4" /></Button>
            <Button size="sm" variant="secondary" disabled title={NOT_WIRED}>Today</Button>
            <Button size="icon-sm" variant="secondary" disabled title={NOT_WIRED}><ChevronRight className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-surface-100 px-4 py-3">
          <div className="flex flex-wrap gap-2">
            {["All Programs", "All Event Types", "All Staff", "Location", "Priority"].map((label) => (
              <button key={label} disabled title={NOT_WIRED} className="inline-flex h-8 items-center gap-2 rounded-md border border-surface-200 bg-white px-3 text-[11px] font-medium text-navy-700 disabled:opacity-70">
                {label}
                <ChevronDown className="h-3 w-3" />
              </button>
            ))}
            <button disabled title={NOT_WIRED} className="inline-flex h-8 items-center gap-2 rounded-md border border-surface-200 bg-white px-3 text-[11px] font-medium text-navy-700 disabled:opacity-70">
              More Filters
              <Filter className="h-3.5 w-3.5 text-brand-600" />
            </button>
          </div>
          <Button size="icon-sm" variant="secondary" disabled title={NOT_WIRED}><Settings2 className="h-4 w-4" /></Button>
        </div>

        <div className="px-4 pt-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-navy-950">{title}</h2>
            <span className="text-[11px] font-medium text-surface-400">{events.length} real event{events.length === 1 ? "" : "s"}</span>
          </div>
          <div className="grid grid-cols-7 overflow-hidden rounded-lg border border-surface-200">
            {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
              <div key={day} className="border-b border-surface-200 bg-surface-50 px-2 py-2 text-center text-[11px] font-bold text-navy-700">{day}</div>
            ))}
            {monthDays.map((day) => {
              const dayEvents = events.filter((event) => isSameDay(event.date, day)).slice(0, 3)
              const outOfMonth = !isSameMonth(day, displayDate)
              const today = isSameDay(day, new Date())
              return (
                <div key={day.toISOString()} className={cn("min-h-[86px] border-r border-b border-surface-100 bg-white p-2 last:border-r-0", outOfMonth && "bg-surface-50/60")}>
                  <div className={cn("mb-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-semibold", today ? "bg-brand-600 text-white" : outOfMonth ? "text-surface-300" : "text-navy-700")}>
                    {day.getDate()}
                  </div>
                  <div className="space-y-1">
                    {dayEvents.map((event) => (
                      <Link key={event.id} href={event.href || "#"} className={cn("block rounded border-l-2 px-1.5 py-1 text-[10px] leading-3", eventClasses(event.kind))}>
                        <span className="block truncate font-bold">{event.title}</span>
                        <span className="block truncate opacity-80">{event.clientName || event.subtitle}</span>
                      </Link>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          <Legend />
        </div>
      </CardContent>
    </Card>
  )
}

function Legend() {
  const items: { label: string; kind: EventKind }[] = [
    { label: "Review", kind: "review" },
    { label: "Signature", kind: "signature" },
    { label: "Validation", kind: "validation" },
    { label: "Approval", kind: "approval" },
    { label: "Task", kind: "task" },
    { label: "Overdue", kind: "overdue" },
  ]
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3 text-[10px] font-semibold text-surface-500">
      {items.map((item) => (
        <span key={item.label} className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", legendDot(item.kind))} />
          {item.label}
        </span>
      ))}
      <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rotate-45 bg-danger-500" /> High Priority</span>
    </div>
  )
}

function UpcomingAgenda({ events, displayDate }: { events: CalendarEvent[]; displayDate: Date }) {
  const agenda = events
    .filter((event) => isSameMonth(event.date, displayDate))
    .sort((a, b) => a.date.getTime() - b.date.getTime())
    .slice(0, 6)

  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardHeader className="border-b border-surface-100 p-4">
        <CardTitle className="text-sm">Upcoming Agenda</CardTitle>
        <button disabled title={NOT_WIRED} className="mt-2 inline-flex h-8 w-fit items-center gap-2 rounded-md border border-surface-200 px-3 text-[11px] font-medium text-navy-700">
          This month
          <ChevronDown className="h-3 w-3" />
        </button>
      </CardHeader>
      <CardContent className="p-0">
        {agenda.length === 0 ? (
          <EmptyState className="py-10" title="No agenda items" description="No dated compliance records were found for this month." />
        ) : (
          <div className="divide-y divide-surface-100">
            {agenda.map((event, index) => (
              <Link key={event.id} href={event.href || "#"} className="grid grid-cols-[58px_1fr_auto] gap-3 px-4 py-3 hover:bg-surface-50">
                <span className="text-[11px] font-bold text-navy-700">{agendaTime(index)}</span>
                <span className="border-l-2 pl-3" style={{ borderColor: kindColor(event.kind) }}>
                  <span className="block text-xs font-bold text-navy-900">{event.title}</span>
                  <span className="block truncate text-[11px] text-surface-500">{event.subtitle}</span>
                </span>
                <Badge variant={priorityVariant(event.priority)} size="sm">{event.priority}</Badge>
              </Link>
            ))}
          </div>
        )}
        <div className="border-t border-surface-100 p-3 text-center">
          <Link href="/tasks" className="text-xs font-bold text-brand-700 hover:underline">View full agenda</Link>
        </div>
      </CardContent>
    </Card>
  )
}

function EventInspector({ event }: { event: CalendarEvent | null }) {
  if (!event) {
    return (
      <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <CardContent>
          <EmptyState className="py-14" icon={<CalendarDays className="h-8 w-8" />} title="No event selected" description="Real calendar records will appear here when dated work exists." />
        </CardContent>
      </Card>
    )
  }

  const completion = statusProgress(event.status)

  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <Badge variant={priorityVariant(event.priority)} size="sm">{event.priority} Priority</Badge>
            <h2 className="mt-3 text-xl font-bold text-navy-950">{event.title}</h2>
            <p className="mt-1 text-xs font-medium text-brand-700">{eventKindLabel(event.kind)} - {event.subtitle}</p>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" disabled title={NOT_WIRED}><Star className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon-sm" disabled title={NOT_WIRED}><LinkIcon className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon-sm" disabled title={NOT_WIRED}><MoreHorizontal className="h-4 w-4" /></Button>
          </div>
        </div>

        <div className="mt-4 rounded-lg border border-surface-100 bg-surface-50 p-3">
          <div className="grid grid-cols-[44px_1fr_1fr] gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">{initials(event.clientName || event.assigneeName || "Higsi")}</div>
            <div>
              <p className="text-xs text-surface-500">Client</p>
              <p className="text-sm font-bold text-navy-950">{event.clientName || "No client attached"}</p>
              <p className="text-[11px] text-surface-500">{event.packetId ? `Packet ${event.packetId.slice(0, 8)}` : "No packet reference"}</p>
            </div>
            <div>
              <p className="text-xs text-surface-500">Assigned To</p>
              <p className="text-sm font-bold text-navy-950">{event.assigneeName || "Unassigned"}</p>
              <p className="text-[11px] text-surface-500">{event.packetType ? packetTypeLabel(event.packetType) : "No program source"}</p>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="font-semibold text-surface-500">Date</dt><dd className="font-bold text-navy-900">{formatDate(event.date)}</dd>
          <dt className="font-semibold text-surface-500">Time</dt><dd className="font-bold text-navy-900">Not tracked</dd>
          <dt className="font-semibold text-surface-500">Location</dt><dd className="font-bold text-navy-900">No location source</dd>
          <dt className="font-semibold text-surface-500">Status</dt><dd><Badge variant="secondary" size="sm">{event.status.replace(/_/g, " ")}</Badge></dd>
          <dt className="font-semibold text-surface-500">Completion</dt><dd><Progress value={completion} size="sm" showValue /></dd>
        </dl>

        <div className="mt-4 border-t border-surface-100 pt-4">
          <div className="mb-2 flex items-center justify-between">
            <p className="text-xs font-bold text-navy-950">Related Documents</p>
            <Badge variant="secondary" size="sm">Source limited</Badge>
          </div>
          <div className="grid grid-cols-2 gap-2">
            {event.packetId ? (
              <Button asChild size="sm" fullWidth>
                <Link href={`/packets/${event.packetId}`}><ExternalLink className="h-4 w-4" /> Open Packet</Link>
              </Button>
            ) : (
              <Button size="sm" fullWidth disabled title="No packet is attached to this record"><Lock className="h-4 w-4" /> Open Packet</Button>
            )}
            <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><FileText className="h-4 w-4" /> Open PDF</Button>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><RefreshCcw className="h-4 w-4" /> Reschedule</Button>
            <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><UserPlus className="h-4 w-4" /> Reassign</Button>
            <Button size="sm" variant="secondary" disabled title={NOT_WIRED}><MessageCircle className="h-4 w-4" /> Comment</Button>
          </div>
          <Button className="mt-2 text-danger-600" size="sm" variant="secondary" fullWidth disabled title={NOT_WIRED}>Cancel Event</Button>
        </div>
      </CardContent>
    </Card>
  )
}

function CalendarAiSidebar({ recommendations, members }: { recommendations: AiRecommendation[]; members: MemberRow[] }) {
  const priorityItems = [
    { label: "Reviews due today", count: 0 },
    { label: "Signature requests pending", count: recommendations.filter((r) => r.type.includes("signature")).length },
    { label: "Validation recommendations", count: recommendations.filter((r) => r.type.includes("validation")).length },
    { label: "AI recommendations open", count: recommendations.length },
  ]

  return (
    <div className="space-y-4">
      <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <CardHeader className="border-b border-surface-100 p-4">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm">Higsi AI Scheduler</CardTitle>
            <Badge variant="info" size="sm">BETA</Badge>
          </div>
        </CardHeader>
        <CardContent className="p-4">
          <p className="text-xs font-bold text-navy-950">Today&apos;s Priorities</p>
          <div className="mt-3 space-y-2.5">
            {priorityItems.map((item) => (
              <div key={item.label} className="flex items-center gap-2 text-[11px]">
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-brand-50 font-bold text-brand-700">{item.count}</span>
                <span className="flex-1 text-navy-700">{item.label}</span>
              </div>
            ))}
          </div>
          <Link href="/ai-copilot" className="mt-3 block text-center text-xs font-bold text-brand-700 hover:underline">View full summary</Link>
        </CardContent>
      </Card>

      <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">AI Recommendations</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {recommendations.length === 0 ? (
            <p className="text-xs text-surface-400">No open AI recommendations.</p>
          ) : (
            <div className="space-y-2">
              {recommendations.slice(0, 5).map((rec) => (
                <div key={rec.id} className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning-500" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-[11px] font-medium text-navy-800">{rec.message}</p>
                  </div>
                  <span className="text-[10px] font-bold text-navy-500">{rec.confidence}%</span>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 space-y-2">
            <Button size="sm" fullWidth disabled title={NOT_WIRED}><Bot className="h-4 w-4" /> Optimize Schedule</Button>
            <Button size="sm" variant="secondary" fullWidth disabled title={NOT_WIRED}>Generate Weekly Plan</Button>
            <Button size="sm" variant="secondary" fullWidth disabled title={NOT_WIRED}><Send className="h-4 w-4" /> Ask Higsi AI</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <CardHeader className="p-4 pb-2">
          <CardTitle className="text-sm">Team Availability</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {members.length === 0 ? (
            <p className="text-xs text-surface-400">No organization users found.</p>
          ) : (
            <div className="space-y-2.5">
              {members.slice(0, 6).map((member) => (
                <div key={member.id} className="flex items-center gap-2">
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-brand-50 text-[10px] font-bold text-brand-700">{initials(member.user.name)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-bold text-navy-900">{member.user.name || member.user.email}</p>
                    <p className="text-[10px] text-surface-400">{member.role.replace(/_/g, " ")}</p>
                  </div>
                  <Badge variant="secondary" size="sm">{member.status}</Badge>
                </div>
              ))}
            </div>
          )}
          <p className="mt-3 text-[10px] text-surface-400">Availability schedules are not tracked yet.</p>
        </CardContent>
      </Card>
    </div>
  )
}

function WorkloadOverview({ workload }: { workload: ReturnType<typeof deriveWorkload> }) {
  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Workload Overview</CardTitle>
        <p className="text-[11px] font-medium text-surface-500">By staff</p>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {workload.length === 0 ? (
          <p className="text-xs text-surface-400">No assigned packets found.</p>
        ) : (
          <div className="space-y-2.5">
            {workload.slice(0, 5).map((row) => (
              <div key={row.name} className="grid grid-cols-[1fr_42px_42px] items-center gap-2 text-[11px]">
                <span className="truncate font-semibold text-navy-900">{row.name}</span>
                <Badge variant={row.overdue > 0 ? "danger" : "success"} size="sm">{row.total}</Badge>
                <span className={cn("text-right font-bold", row.overdue > 0 ? "text-danger-600" : "text-surface-400")}>{row.overdue}</span>
              </div>
            ))}
          </div>
        )}
        <Link href="/tasks" className="mt-4 block text-center text-xs font-bold text-brand-700 hover:underline">View workload report</Link>
      </CardContent>
    </Card>
  )
}

function ComplianceTimeline({ stages }: { stages: ReturnType<typeof deriveTimeline> }) {
  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Compliance Timeline</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="grid grid-cols-6 gap-2">
          {stages.map((stage, index) => {
            const Icon = stage.done ? ShieldCheck : Circle
            return (
              <div key={stage.label} className="relative text-center">
                {index < stages.length - 1 && <span className="absolute left-1/2 top-4 h-px w-full bg-surface-200" />}
                <span className={cn("relative mx-auto flex h-8 w-8 items-center justify-center rounded-full border bg-white", stage.done ? "border-success-200 text-success-600" : "border-surface-200 text-surface-300")}>
                  <Icon className="h-4 w-4" />
                </span>
                <p className="mt-2 text-[10px] font-bold leading-3 text-navy-800">{stage.label}</p>
                <p className="mt-1 text-[10px] text-surface-400">{stage.count}</p>
              </div>
            )
          })}
        </div>
        <Link href="/packets" className="mt-4 block text-center text-xs font-bold text-brand-700 hover:underline">View full timeline</Link>
      </CardContent>
    </Card>
  )
}

function DeadlinesCard({ deadlines, events }: { deadlines: UpcomingDeadline[]; events: CalendarEvent[] }) {
  const visible = deadlines.length > 0
    ? deadlines.map((d) => ({ id: d.packetId, title: `${packetTypeLabel(d.packetType)} - ${d.clientName}`, date: d.dueDate, href: `/packets/${d.packetId}` }))
    : events.filter((event) => event.date >= new Date()).sort((a, b) => a.date.getTime() - b.date.getTime()).slice(0, 5).map((event) => ({ id: event.id, title: `${event.title} - ${event.clientName || event.subtitle}`, date: event.date, href: event.href || "#" }))

  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Upcoming Deadlines</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        {visible.length === 0 ? (
          <p className="text-xs text-surface-400">No future dated compliance deadlines found.</p>
        ) : (
          <div className="space-y-2.5">
            {visible.slice(0, 5).map((deadline) => (
              <Link key={deadline.id} href={deadline.href} className="flex items-center justify-between gap-3 text-[11px]">
                <span className="truncate font-semibold text-navy-900">{deadline.title}</span>
                <Badge variant={isSameDay(deadline.date, new Date()) ? "danger" : "success"} size="sm">{deadlineLabel(deadline.date)}</Badge>
              </Link>
            ))}
          </div>
        )}
        <Link href="/tasks" className="mt-4 block text-center text-xs font-bold text-brand-700 hover:underline">View all deadlines</Link>
      </CardContent>
    </Card>
  )
}

function CalendarAnalytics({ analytics }: { analytics: ReturnType<typeof deriveAnalytics> }) {
  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Calendar Analytics</CardTitle>
        <p className="text-[11px] font-medium text-surface-500">30 days</p>
      </CardHeader>
      <CardContent className="space-y-3 p-4 pt-0">
        {analytics.map((metric) => (
          <div key={metric.label} className="grid grid-cols-[1fr_44px_58px] items-center gap-2 text-[11px]">
            <span className="font-semibold text-navy-800">{metric.label}</span>
            <span className="text-right font-bold text-navy-950">{metric.value}</span>
            <Sparkline points={metric.points} height={18} stroke={metric.stroke} fill="transparent" />
          </div>
        ))}
        <Link href="/reports" className="block text-center text-xs font-bold text-brand-700 hover:underline">View full analytics</Link>
      </CardContent>
    </Card>
  )
}

function QuickActions() {
  const actions = [
    { label: "Schedule Annual Review", icon: CalendarCheck2 },
    { label: "Schedule 45-Day Review", icon: CalendarDays },
    { label: "Create Audit", icon: ClipboardCheck },
    { label: "Assign Staff", icon: Users },
    { label: "Request Signature", icon: FileSignature },
    { label: "Run Validation", icon: ShieldAlert },
    { label: "Open PDF", icon: FileText },
    { label: "Generate Report", icon: BarChart3 },
  ]

  return (
    <Card className="rounded-lg border-surface-200 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <CardHeader className="p-4 pb-2">
        <CardTitle className="text-sm">Quick Actions</CardTitle>
      </CardHeader>
      <CardContent className="p-4 pt-0">
        <div className="grid grid-cols-2 gap-2">
          {actions.map((action) => {
            const Icon = action.icon
            return (
              <button key={action.label} disabled title={NOT_WIRED} className="flex min-h-[58px] flex-col items-center justify-center gap-1 rounded-lg border border-surface-200 bg-white px-2 text-center text-[10px] font-bold text-navy-700 opacity-70">
                <Icon className="h-4 w-4 text-brand-600" />
                {action.label}
              </button>
            )
          })}
        </div>
        <p className="mt-3 text-center text-[10px] text-surface-400">Actions require backend scheduling support.</p>
      </CardContent>
    </Card>
  )
}

function buildCalendarEvents(packets: PacketRow[], signatures: SignatureRow[], approvals: ApprovalRow[], validations: ValidationRow[]): CalendarEvent[] {
  const packetEvents = packets
    .filter((packet) => packet.dueDate)
    .map((packet) => {
      const overdue = isPast(packet.dueDate as Date) && !["approved", "archived"].includes(packet.status)
      return {
        id: `packet-${packet.id}`,
        kind: overdue ? "overdue" as const : "review" as const,
        title: packetTypeLabel(packet.packetType),
        subtitle: "Packet due date",
        date: packet.dueDate as Date,
        status: packet.status,
        priority: overdue ? "High" as const : priorityFromDate(packet.dueDate as Date),
        clientName: `${packet.client.firstName} ${packet.client.lastName}`,
        assigneeName: packet.assignedTo?.name ?? null,
        packetId: packet.id,
        packetType: packet.packetType,
        href: `/packets/${packet.id}`,
      }
    })

  const signatureEvents = signatures
    .filter((request) => request.dueDate)
    .map((request) => {
      const clientName = request.packet?.client ? `${request.packet.client.firstName} ${request.packet.client.lastName}` : undefined
      return {
        id: `signature-${request.id}`,
        kind: "signature" as const,
        title: "Signature Due",
        subtitle: request.signerName,
        date: request.dueDate as Date,
        status: request.status,
        priority: priorityFromDate(request.dueDate as Date),
        clientName,
        assigneeName: request.requestedBy?.name ?? null,
        packetId: request.packetId,
        packetType: request.packet?.packetType ?? null,
        href: `/signatures/${request.id}`,
      }
    })

  const approvalEvents = approvals.map((approval) => {
    const clientName = approval.packet?.client ? `${approval.packet.client.firstName} ${approval.packet.client.lastName}` : undefined
    return {
      id: `approval-${approval.id}`,
      kind: "approval" as const,
      title: "Approval Review",
      subtitle: approval.submittedBy?.name ? `Submitted by ${approval.submittedBy.name}` : "Approval request",
      date: approval.createdAt,
      status: approval.status,
      priority: approval.status === "pending" ? "Medium" as const : "Low" as const,
      clientName,
      assigneeName: approval.approver?.name ?? null,
      packetId: approval.packetId,
      packetType: approval.packet?.packetType ?? null,
      href: `/approvals/${approval.id}`,
    }
  })

  const validationEvents = validations.map((validation) => {
    const clientName = validation.packet?.client ? `${validation.packet.client.firstName} ${validation.packet.client.lastName}` : undefined
    return {
      id: `validation-${validation.id}`,
      kind: "validation" as const,
      title: validation.criticalCount > 0 ? "Validation Deadline" : "Validation Review",
      subtitle: validation.packet ? packetTypeLabel(validation.packet.packetType) : "Validation result",
      date: validation.ranAt,
      status: validation.criticalCount > 0 ? "failed" : "passed",
      priority: validation.criticalCount > 0 ? "High" as const : "Low" as const,
      clientName,
      assigneeName: validation.ranBy?.name ?? null,
      packetId: validation.packetId,
      packetType: validation.packet?.packetType ?? null,
      href: `/validation/${validation.id}`,
    }
  })

  return [...packetEvents, ...signatureEvents, ...approvalEvents, ...validationEvents].sort((a, b) => a.date.getTime() - b.date.getTime())
}

function buildKpis(packets: PacketRow[], signatures: SignatureRow[], validations: ValidationRow[], approvals: ApprovalRow[], aiRecs: AiRecommendation[]): CalendarKpi[] {
  const now = new Date()
  const in30 = new Date(now.getTime() + 30 * 86400000)
  const openPackets = packets.filter((packet) => !["approved", "archived"].includes(packet.status))
  const dueToday = openPackets.filter((packet) => packet.dueDate && isSameDay(packet.dueDate, now)).length
  const upcoming = openPackets.filter((packet) => packet.dueDate && packet.dueDate > now && packet.dueDate <= in30).length
  const overdue = openPackets.filter((packet) => packet.dueDate && packet.dueDate < now).length
  const pendingSignatures = signatures.filter((request) => ["pending", "sent", "viewed"].includes(request.status)).length
  const validationDeadlines = validations.filter((result) => result.criticalCount > 0 || result.warningCount > 0).length
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending").length

  return [
    { label: "Reviews Due Today", value: String(dueToday), helper: realDataHelper(dueToday), icon: CalendarCheck2, tone: "brand", points: trendFromValue(dueToday) },
    { label: "Upcoming Reviews", value: String(upcoming), helper: "next 30 days", icon: Clock, tone: "success", points: trendFromValue(upcoming) },
    { label: "Overdue Reviews", value: String(overdue), helper: overdue > 0 ? "needs action" : "clear", icon: AlertTriangle, tone: "danger", points: trendFromValue(overdue) },
    { label: "Pending Signatures", value: String(pendingSignatures), helper: "real requests", icon: FileSignature, tone: "purple", points: trendFromValue(pendingSignatures) },
    { label: "Validation Deadlines", value: String(validationDeadlines), helper: "issues found", icon: ShieldAlert, tone: "teal", points: trendFromValue(validationDeadlines) },
    { label: "Certifications Expiring", value: "0", helper: "no source", icon: BadgeCheck, tone: "success", points: [0, 0, 0, 0, 0], disabled: true },
    { label: "Scheduled Audits", value: "0", helper: "no source", icon: ClipboardCheck, tone: "navy", points: [0, 0, 0, 0, 0], disabled: true },
    { label: "AI Scheduling Alerts", value: String(aiRecs.length), helper: "open AI recs", icon: Sparkles, tone: "danger", points: trendFromValue(aiRecs.length) },
    { label: "Pending Approvals", value: String(pendingApprovals), helper: "approval queue", icon: FileCheck2, tone: "amber", points: trendFromValue(pendingApprovals) },
  ]
}

function deriveWorkload(packets: PacketRow[], members: MemberRow[]) {
  const rows = new Map<string, { name: string; total: number; overdue: number }>()
  for (const member of members) {
    const name = member.user.name || member.user.email
    rows.set(name, { name, total: 0, overdue: 0 })
  }
  for (const packet of packets) {
    const name = packet.assignedTo?.name || "Unassigned"
    const existing = rows.get(name) || { name, total: 0, overdue: 0 }
    existing.total += 1
    if (packet.dueDate && packet.dueDate < new Date() && !["approved", "archived"].includes(packet.status)) existing.overdue += 1
    rows.set(name, existing)
  }
  return Array.from(rows.values()).filter((row) => row.total > 0).sort((a, b) => b.total - a.total)
}

function deriveTimeline(packets: PacketRow[], signatures: SignatureRow[], approvals: ApprovalRow[], validations: ValidationRow[]) {
  return [
    { label: "Packet Created", count: packets.length, done: packets.length > 0 },
    { label: "Intake Complete", count: packets.filter((packet) => ["needs_validation", "awaiting_signature", "submitted", "approved"].includes(packet.status)).length, done: packets.some((packet) => ["needs_validation", "awaiting_signature", "submitted", "approved"].includes(packet.status)) },
    { label: "Validation", count: validations.length, done: validations.length > 0 },
    { label: "Signatures", count: signatures.filter((request) => request.status === "signed").length, done: signatures.some((request) => request.status === "signed") },
    { label: "Approval", count: approvals.filter((request) => request.status === "approved").length, done: approvals.some((request) => request.status === "approved") },
    { label: "Audit", count: 0, done: false },
  ]
}

function deriveAnalytics(packets: PacketRow[], signatures: SignatureRow[], auditScore: number | null) {
  const completed = packets.filter((packet) => ["approved", "archived"].includes(packet.status)).length
  const onTime = packets.filter((packet) => !packet.dueDate || packet.dueDate >= new Date() || ["approved", "archived"].includes(packet.status)).length
  const overdue = packets.filter((packet) => packet.dueDate && packet.dueDate < new Date() && !["approved", "archived"].includes(packet.status)).length
  const signed = signatures.filter((request) => request.status === "signed").length
  const completionRate = packets.length ? Math.round((completed / packets.length) * 100) : 0
  const onTimeRate = packets.length ? Math.round((onTime / packets.length) * 100) : 0

  return [
    { label: "Reviews Completed", value: String(completed), points: trendFromValue(completed), stroke: "#2563eb" },
    { label: "On-Time Completion", value: `${onTimeRate}%`, points: trendFromValue(onTimeRate), stroke: "#16a34a" },
    { label: "Overdue Items", value: String(overdue), points: trendFromValue(overdue), stroke: "#ef4444" },
    { label: "Signed Requests", value: String(signed), points: trendFromValue(signed), stroke: "#7c3aed" },
    { label: "Audit Readiness", value: auditScore !== null ? `${auditScore}%` : "NA", points: trendFromValue(auditScore ?? 0), stroke: "#0f3b82" },
  ]
}

function pickDisplayDate(events: CalendarEvent[]) {
  if (events.length === 0) return new Date()
  const now = new Date()
  return events.find((event) => event.date >= now)?.date || events[events.length - 1].date
}

function chooseFocusedEvent(events: CalendarEvent[], displayDate: Date) {
  const sameMonth = events.filter((event) => isSameMonth(event.date, displayDate))
  return sameMonth.find((event) => event.priority === "High") || sameMonth[0] || events[0] || null
}

function buildMonthDays(date: Date) {
  const first = new Date(date.getFullYear(), date.getMonth(), 1)
  const start = new Date(first)
  start.setDate(first.getDate() - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const day = new Date(start)
    day.setDate(start.getDate() + index)
    return day
  })
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

function isSameMonth(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()
}

function isPast(date: Date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  return date < today
}

function packetTypeLabel(type: string): string {
  return type
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ")
}

function priorityFromDate(date: Date): EventPriority {
  const days = (date.getTime() - Date.now()) / 86400000
  if (days < 0 || days <= 2) return "High"
  if (days <= 7) return "Medium"
  return "Low"
}

function priorityVariant(priority: EventPriority) {
  if (priority === "High") return "danger"
  if (priority === "Medium") return "warning"
  return "success"
}

function eventKindLabel(kind: EventKind) {
  const labels: Record<EventKind, string> = {
    review: "Review",
    signature: "Signature",
    validation: "Validation",
    approval: "Approval",
    audit: "Audit",
    task: "Task",
    overdue: "Overdue",
  }
  return labels[kind]
}

function statusProgress(status: string) {
  const normalized = status.toLowerCase()
  if (["approved", "archived", "signed", "passed", "completed"].includes(normalized)) return 100
  if (["submitted", "awaiting_signature", "sent", "viewed"].includes(normalized)) return 70
  if (["needs_validation", "in_progress", "pending"].includes(normalized)) return 50
  if (["validation_failed", "failed", "rejected", "declined"].includes(normalized)) return 30
  return 15
}

function trendFromValue(value: number) {
  const base = Math.max(0, value)
  return [Math.max(0, base - 2), base + 1, Math.max(0, base - 1), base + 2, base, base + 3, Math.max(0, base - 1)]
}

function realDataHelper(value: number) {
  return value > 0 ? "real records" : "none today"
}

function deadlineLabel(date: Date) {
  if (isSameDay(date, new Date())) return "Today"
  const days = Math.ceil((date.getTime() - Date.now()) / 86400000)
  if (days < 0) return "Overdue"
  return `${days} day${days === 1 ? "" : "s"}`
}

function agendaTime(index: number) {
  return ["8:00 AM", "9:30 AM", "11:00 AM", "1:00 PM", "2:30 PM", "4:00 PM"][index] || "All day"
}

function initials(name?: string | null) {
  if (!name) return "?"
  return name.split(" ").map((part) => part[0]).join("").toUpperCase().slice(0, 2)
}

function kpiTone(tone: CalendarKpi["tone"]) {
  const tones = {
    brand: { icon: "text-brand-600", iconBg: "bg-brand-50", text: "text-brand-600", stroke: "#2563eb", fill: "rgba(37,99,235,0.1)" },
    success: { icon: "text-success-600", iconBg: "bg-success-50", text: "text-success-600", stroke: "#16a34a", fill: "rgba(22,163,74,0.1)" },
    danger: { icon: "text-danger-600", iconBg: "bg-danger-50", text: "text-danger-600", stroke: "#ef4444", fill: "rgba(239,68,68,0.1)" },
    purple: { icon: "text-violet-600", iconBg: "bg-violet-50", text: "text-violet-600", stroke: "#7c3aed", fill: "rgba(124,58,237,0.1)" },
    teal: { icon: "text-emerald-600", iconBg: "bg-emerald-50", text: "text-emerald-600", stroke: "#059669", fill: "rgba(5,150,105,0.1)" },
    amber: { icon: "text-warning-600", iconBg: "bg-warning-50", text: "text-warning-600", stroke: "#d97706", fill: "rgba(217,119,6,0.1)" },
    navy: { icon: "text-navy-600", iconBg: "bg-navy-50", text: "text-navy-600", stroke: "#1e3a8a", fill: "rgba(30,58,138,0.1)" },
  }
  return tones[tone]
}

function eventClasses(kind: EventKind) {
  const classes: Record<EventKind, string> = {
    review: "border-brand-500 bg-brand-50 text-brand-900",
    signature: "border-success-500 bg-success-50 text-success-900",
    validation: "border-violet-500 bg-violet-50 text-violet-900",
    approval: "border-warning-500 bg-warning-50 text-warning-900",
    audit: "border-orange-500 bg-orange-50 text-orange-900",
    task: "border-navy-500 bg-navy-50 text-navy-900",
    overdue: "border-danger-500 bg-danger-50 text-danger-900",
  }
  return classes[kind]
}

function legendDot(kind: EventKind) {
  const classes: Record<EventKind, string> = {
    review: "bg-brand-500",
    signature: "bg-success-500",
    validation: "bg-violet-500",
    approval: "bg-warning-500",
    audit: "bg-orange-500",
    task: "bg-navy-500",
    overdue: "bg-danger-500",
  }
  return classes[kind]
}

function kindColor(kind: EventKind) {
  const colors: Record<EventKind, string> = {
    review: "#2563eb",
    signature: "#16a34a",
    validation: "#7c3aed",
    approval: "#d97706",
    audit: "#ea580c",
    task: "#1e3a8a",
    overdue: "#ef4444",
  }
  return colors[kind]
}
