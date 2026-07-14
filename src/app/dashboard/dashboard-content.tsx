import Link from "next/link"
import { prisma } from "@/lib/db"
import {
  CLIENT_READ_ROLES,
  ORGANIZATION_WIDE_CLIENT_ROLES,
  requireGlobalSuperAdmin,
  requireOrganizationRole,
} from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import { UserRole } from "@prisma/client"
import {
  Users, FolderOpen, ShieldCheck, PenSquare, AlertTriangle, Clock, Plus,
  ArrowRight, TrendingUp, TrendingDown, CheckSquare, SearchCheck, Library,
  UserPlus, Upload, FileCheck2, Globe, ArrowUpRight,
} from "lucide-react"
import { formatDate } from "@/lib/utils"

const ACTIVE_STATUSES = ["draft", "in_progress", "needs_validation", "validation_failed", "awaiting_signature", "awaiting_approval"]

function packetTypeLabel(type: string): string {
  return type.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase())
}

interface Props {
  orgId?: string
  isSuperAdmin: boolean
  userId: string
  userName?: string
  role: UserRole
}

export async function DashboardContent({ orgId, userName }: Props) {
  if (!orgId) {
    await requireGlobalSuperAdmin("view platform dashboard")
    return <SuperAdminDashboard />
  }

  const now = new Date()
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "view organization dashboard")
  const userId = authorization.userId
  const isFullAccess = ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role)
  const assignments = { some: {
    staffUserId: userId,
    AND: [
      { OR: [{ startDate: null }, { startDate: { lte: now } }] },
      { OR: [{ endDate: null }, { endDate: { gt: now } }] },
    ],
  } }
  const clientScope = isFullAccess ? {} : { client: { assignments } }
  const in30Days = new Date(now.getTime() + 30 * 86400000)
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000)
  const sixtyDaysAgo = new Date(now.getTime() - 60 * 86400000)

  const [
    clientCount,
    packets,
    pendingSignatures,
    pendingApprovals,
    scoresThisPeriod,
    scoresPriorPeriod,
    recentAudits,
    openCriticalIssues,
  ] = await Promise.all([
    prisma.client.count({ where: { organizationId: orgId, status: "active", ...(isFullAccess ? {} : { assignments }) } }),
    prisma.packet.findMany({
      where: { organizationId: orgId, ...clientScope },
      orderBy: { updatedAt: "desc" },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        documents: { select: { status: true, isRequired: true } },
      },
    }),
    prisma.signatureRequest.findMany({
      where: {
        organizationId: orgId, status: { in: ["pending", "sent", "viewed"] },
        ...(clientScope.client ? { packet: { client: clientScope.client } } : {}),
      } as any,
      orderBy: [{ dueDate: "asc" }, { createdAt: "asc" }],
      take: 20,
      include: { packet: { include: { client: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.approvalRequest.findMany({
      where: { organizationId: orgId, status: "pending", ...(isFullAccess ? {} : { approverId: userId }) },
      orderBy: { submittedAt: "asc" },
      take: 10,
      include: { packet: { include: { client: { select: { firstName: true, lastName: true } } } } },
    }),
    prisma.validationResult.findMany({ where: { organizationId: orgId, ranAt: { gte: thirtyDaysAgo }, ...(clientScope.client ? { packet: { client: clientScope.client } } : {}) }, select: { score: true } }),
    prisma.validationResult.findMany({ where: { organizationId: orgId, ranAt: { gte: sixtyDaysAgo, lt: thirtyDaysAgo }, ...(clientScope.client ? { packet: { client: clientScope.client } } : {}) }, select: { score: true } }),
    prisma.auditEvent.findMany({
      where: { organizationId: orgId, ...(isFullAccess ? {} : { actorId: userId }) },
      orderBy: { createdAt: "desc" },
      take: 6,
      include: { actor: { select: { name: true } } },
    }),
    prisma.validationResult.findMany({
      where: {
        organizationId: orgId, criticalCount: { gt: 0 },
        ...(clientScope.client ? { packet: { client: clientScope.client } } : {}),
      } as any,
      orderBy: { ranAt: "desc" },
      take: 10,
      distinct: ["packetId"],
      include: { packet: { include: { client: { select: { firstName: true, lastName: true } } } } },
    }),
  ])

  // Audit-log the dashboard view for sensitive access
  createAuditEvent({
    action: "CLIENT_VIEWED", actorId: userId, organizationId: orgId,
    targetType: "dashboard", metadata: { clientCount, packetCount: packets.length },
  })

  // --- KPI derivation (all from real, currently-stored data) ---
  const openPackets = packets.filter((p) => !["approved", "archived"].includes(p.status))
  const overduePackets = openPackets.filter((p) => p.dueDate && p.dueDate < now)
  const upcomingPackets = openPackets.filter((p) => p.dueDate && p.dueDate >= now && p.dueDate <= in30Days)
  const inProgressPackets = packets.filter((p) => ACTIVE_STATUSES.includes(p.status) && p.status !== "draft")

  const avgScore = (rows: { score: number }[]) => rows.length ? Math.round(rows.reduce((s, r) => s + r.score, 0) / rows.length) : null
  const complianceScore = avgScore(scoresThisPeriod)
  const priorComplianceScore = avgScore(scoresPriorPeriod)
  const complianceTrend = complianceScore !== null && priorComplianceScore !== null ? complianceScore - priorComplianceScore : null

  const requiredDocs = packets.flatMap((p) => p.documents.filter((d) => d.isRequired))
  const completedRequiredDocs = requiredDocs.filter((d) => d.status === "completed")
  const auditReadiness = requiredDocs.length ? Math.round((completedRequiredDocs.length / requiredDocs.length) * 100) : null

  const distinctClients = (rows: { client?: { id?: string } | null; clientId?: string }[]) =>
    new Set(rows.map((r) => r.clientId ?? r.client?.id).filter(Boolean)).size

  const kpis = [
    { label: "Compliance Score", value: complianceScore, suffix: "%", trend: complianceTrend, icon: ShieldCheck, sub: null },
    { label: "Audit Readiness", value: auditReadiness, suffix: "%", trend: null, icon: FileCheck2, sub: null },
    { label: "Pending Signatures", value: pendingSignatures.length, suffix: "", trend: null, icon: PenSquare, sub: `Across ${distinctClients(pendingSignatures.map((s) => ({ clientId: s.packet?.clientId })))} clients` },
    { label: "Overdue Reviews", value: overduePackets.length, suffix: "", trend: null, icon: AlertTriangle, sub: `Across ${distinctClients(overduePackets)} clients` },
    { label: "Packets In Progress", value: inProgressPackets.length, suffix: "", trend: null, icon: FolderOpen, sub: `Across ${distinctClients(inProgressPackets)} clients` },
    { label: "Upcoming Reviews", value: upcomingPackets.length, suffix: "", trend: null, icon: Clock, sub: "Next 30 days" },
  ]

  // --- Work queue: real actionable items (signatures + approvals awaiting action) ---
  const workQueue = [
    ...pendingSignatures.slice(0, 5).map((s) => ({
      key: `sig-${s.id}`,
      icon: PenSquare,
      title: `${s.signerName} signature ${s.status === "pending" ? "not yet sent" : s.status}`,
      subtitle: `${s.packet?.client ? `${s.packet.client.firstName} ${s.packet.client.lastName}` : "Unknown client"} · ${s.signerRole.replace(/_/g, " ")}`,
      due: s.dueDate,
      href: `/signatures/${s.id}`,
    })),
    ...pendingApprovals.slice(0, 5).map((a) => ({
      key: `appr-${a.id}`,
      icon: CheckSquare,
      title: "Awaiting your approval",
      subtitle: a.packet?.client ? `${a.packet.client.firstName} ${a.packet.client.lastName} · ${packetTypeLabel(a.packet.packetType)}` : "Packet approval",
      due: a.submittedAt,
      href: `/approvals/${a.id}`,
    })),
  ]
    .sort((a, b) => (a.due ? a.due.getTime() : Infinity) - (b.due ? b.due.getTime() : Infinity))
    .slice(0, 6)

  // --- Overdue & risk alerts ---
  const riskItems = [
    ...overduePackets.slice(0, 5).map((p) => ({
      key: `overdue-${p.id}`,
      severity: "danger" as const,
      title: `${p.client.firstName} ${p.client.lastName}`,
      subtitle: `${packetTypeLabel(p.packetType)} · ${Math.max(1, Math.round((now.getTime() - p.dueDate!.getTime()) / 86400000))} day${Math.round((now.getTime() - p.dueDate!.getTime()) / 86400000) === 1 ? "" : "s"} overdue`,
      href: `/packets/${p.id}`,
    })),
    ...openCriticalIssues.slice(0, 4).map((v) => ({
      key: `risk-${v.id}`,
      severity: "warning" as const,
      title: v.packet?.client ? `${v.packet.client.firstName} ${v.packet.client.lastName}` : "Validation risk",
      subtitle: `${v.criticalCount} critical validation issue${v.criticalCount === 1 ? "" : "s"}`,
      href: v.packetId ? `/packets/${v.packetId}` : "/validation",
    })),
  ].slice(0, 6)

  // --- Recent packets w/ completion ---
  const recentPackets = packets.slice(0, 5).map((p) => {
    const required = p.documents.filter((d) => d.isRequired)
    const completed = required.filter((d) => d.status === "completed")
    const pct = required.length ? Math.round((completed.length / required.length) * 100) : 0
    return { id: p.id, client: p.client, packetType: p.packetType, status: p.status, pct }
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Dashboard</h1>
          <p className="mt-1 text-sm text-surface-500">
            Welcome back{userName ? `, ${userName.split(" ")[0]}` : ""}. Here&apos;s what&apos;s happening with your caseload today.
          </p>
        </div>
        <Link href="/packets/new">
          <Button>
            <Plus className="h-4 w-4" />
            New Packet
          </Button>
        </Link>
      </div>

      {/* KPI row */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((kpi) => {
          const Icon = kpi.icon
          return (
            <Card key={kpi.label}>
              <CardContent className="p-4">
                <div className="flex items-center gap-2 text-surface-500">
                  <Icon className="h-4 w-4" />
                  <span className="text-xs font-medium">{kpi.label}</span>
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className="text-2xl font-bold text-surface-900">
                    {kpi.value === null ? "—" : `${kpi.value}${kpi.suffix}`}
                  </span>
                  {kpi.trend !== null && kpi.trend !== undefined && (
                    <span className={`flex items-center text-xs font-medium ${kpi.trend >= 0 ? "text-success-600" : "text-danger-600"}`}>
                      {kpi.trend >= 0 ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                      {Math.abs(kpi.trend)}%
                    </span>
                  )}
                </div>
                {kpi.sub && <p className="mt-1 text-xs text-surface-400">{kpi.sub}</p>}
              </CardContent>
            </Card>
          )
        })}
      </div>

      {/* Work queue + Packet status */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Work Queue</CardTitle>
              <CardDescription>Signatures and approvals waiting on action</CardDescription>
            </div>
            {workQueue.length > 0 && (
              <Link href="/signatures"><Button variant="ghost" size="sm">View all <ArrowRight className="h-3 w-3" /></Button></Link>
            )}
          </CardHeader>
          <CardContent>
            {workQueue.length > 0 ? (
              <div className="space-y-2">
                {workQueue.map((item) => {
                  const Icon = item.icon
                  return (
                    <Link
                      key={item.key}
                      href={item.href}
                      className="flex items-center justify-between rounded-lg border border-surface-100 p-3 hover:bg-surface-50 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-warning-50 shrink-0">
                          <Icon className="h-4 w-4 text-warning-600" />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-surface-900 truncate">{item.title}</p>
                          <p className="text-xs text-surface-500 truncate">{item.subtitle}</p>
                        </div>
                      </div>
                      {item.due && <span className="text-xs text-surface-400 shrink-0">{formatDate(item.due)}</span>}
                    </Link>
                  )
                })}
              </div>
            ) : (
              <EmptyState title="Nothing needs your attention" description="No pending signatures or approvals right now." icon={<CheckSquare className="h-8 w-8" />} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Packet Status</CardTitle>
              <CardDescription>Latest client packet activity</CardDescription>
            </div>
            {recentPackets.length > 0 && (
              <Link href="/packets"><Button variant="ghost" size="sm">View all <ArrowRight className="h-3 w-3" /></Button></Link>
            )}
          </CardHeader>
          <CardContent>
            {recentPackets.length > 0 ? (
              <div className="space-y-3">
                {recentPackets.map((p) => (
                  <Link key={p.id} href={`/packets/${p.id}`} className="block rounded-lg border border-surface-100 p-3 hover:bg-surface-50 transition-colors">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-surface-900 truncate">{p.client.firstName} {p.client.lastName}</p>
                        <p className="text-xs text-surface-500 truncate">{packetTypeLabel(p.packetType)}</p>
                      </div>
                      <StatusChip status={p.status} size="sm" />
                    </div>
                    <Progress value={p.pct} size="sm" className="mt-2" />
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="No packets yet" description="Create a packet to start the compliance workflow" icon={<FolderOpen className="h-8 w-8" />} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Overdue/risk + Recent activity */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overdue &amp; Risk Alerts</CardTitle>
            <CardDescription>Packets past due or carrying critical validation issues</CardDescription>
          </CardHeader>
          <CardContent>
            {riskItems.length > 0 ? (
              <div className="space-y-2">
                {riskItems.map((item) => (
                  <Link
                    key={item.key}
                    href={item.href}
                    className="flex items-center justify-between rounded-lg border border-surface-100 p-3 hover:bg-surface-50 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`flex h-9 w-9 items-center justify-center rounded-lg shrink-0 ${item.severity === "danger" ? "bg-danger-50" : "bg-warning-50"}`}>
                        <AlertTriangle className={`h-4 w-4 ${item.severity === "danger" ? "text-danger-600" : "text-warning-600"}`} />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-surface-900 truncate">{item.title}</p>
                        <p className="text-xs text-surface-500 truncate">{item.subtitle}</p>
                      </div>
                    </div>
                    <Badge variant={item.severity === "danger" ? "danger" : "warning"} size="sm">
                      {item.severity === "danger" ? "Overdue" : "At risk"}
                    </Badge>
                  </Link>
                ))}
              </div>
            ) : (
              <EmptyState title="All clear" description="No overdue packets or critical validation issues." icon={<ShieldCheck className="h-8 w-8" />} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Activity</CardTitle>
              <CardDescription>Latest audit trail events</CardDescription>
            </div>
            {recentAudits.length > 0 && (
              <Link href="/audit"><Button variant="ghost" size="sm">View all <ArrowRight className="h-3 w-3" /></Button></Link>
            )}
          </CardHeader>
          <CardContent>
            {recentAudits.length > 0 ? (
              <div className="space-y-2">
                {recentAudits.map((event) => (
                  <div key={event.id} className="flex items-center gap-3 py-2 border-b border-surface-100 last:border-0">
                    <div className="flex h-7 w-7 items-center justify-center rounded-full bg-surface-100 shrink-0">
                      <Clock className="h-3.5 w-3.5 text-surface-400" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-surface-700 truncate">
                        <span className="font-medium">{event.actor?.name || "System"}</span>
                        {" "}{event.action.toLowerCase().replace(/_/g, " ")}
                        {event.targetType && <span className="text-surface-400"> on {event.targetType}</span>}
                      </p>
                    </div>
                    <span className="text-xs text-surface-400 shrink-0">{formatDate(event.createdAt)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState title="No activity yet" description="Actions across your organization will show up here." icon={<Clock className="h-8 w-8" />} />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick actions */}
      <Card>
        <CardHeader>
          <CardTitle>Quick Actions</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <QuickAction href="/clients/new" icon={UserPlus} label="Create New Client" />
            <QuickAction href="/packets/new" icon={FolderOpen} label="Start Intake Packet" />
            <QuickAction href="/signatures" icon={PenSquare} label="Request Signatures" />
            <QuickAction href="/validation" icon={ShieldCheck} label="Check Compliance" />
            <QuickAction href="/library" icon={Library} label="Open Document Library" />
            <QuickAction href="/audit" icon={SearchCheck} label="View Audit Center" />
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function QuickAction({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <Link
      href={href}
      className="flex items-center gap-3 rounded-lg border border-surface-200 p-3 text-sm font-medium text-surface-700 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700 transition-colors"
    >
      <Icon className="h-4 w-4 shrink-0" />
      {label}
      <ArrowUpRight className="ml-auto h-3.5 w-3.5 text-surface-300" />
    </Link>
  )
}

async function SuperAdminDashboard() {
  const [orgCount, userCount, clientCount] = await Promise.all([
    prisma.organization.count(),
    prisma.user.count(),
    prisma.client.count(),
  ])

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Platform Overview</h1>
        <p className="mt-1 text-sm text-surface-500">Monitor platform-wide activity and health</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card><CardContent className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-50 text-brand-600"><Globe className="h-6 w-6" /></div>
          <div><p className="text-2xl font-bold text-surface-900">{orgCount}</p><p className="text-xs text-surface-500">Organizations</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-success-50 text-success-600"><Users className="h-6 w-6" /></div>
          <div><p className="text-2xl font-bold text-surface-900">{userCount}</p><p className="text-xs text-surface-500">Users</p></div>
        </CardContent></Card>
        <Card><CardContent className="flex items-center gap-4 p-5">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-warning-50 text-warning-600"><FolderOpen className="h-6 w-6" /></div>
          <div><p className="text-2xl font-bold text-surface-900">{clientCount}</p><p className="text-xs text-surface-500">Clients (all orgs)</p></div>
        </CardContent></Card>
      </div>
      <Card>
        <CardContent className="py-16">
          <EmptyState
            title="Switch to an organization"
            description="Select an organization to see its compliance dashboard"
            icon={<Globe className="h-8 w-8" />}
          />
        </CardContent>
      </Card>
    </div>
  )
}
