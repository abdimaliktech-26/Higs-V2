import type { ReactNode } from "react"
import Link from "next/link"
import { getAvailableStaff, getClientById, getPrograms } from "@/lib/actions/client"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Progress } from "@/components/ui/progress"
import { StatusChip } from "@/components/ui/status-chip"
import { cn, formatDate, formatDateTime } from "@/lib/utils"
import {
  Activity,
  ArrowUpRight,
  BarChart3,
  Bot,
  CheckCircle2,
  ChevronDown,
  ClipboardCheck,
  Download,
  Edit,
  FileSearch,
  FileText,
  FolderOpen,
  HeartPulse,
  History,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Plus,
  Search,
  ShieldAlert,
  ShieldCheck,
  Signature,
  Sparkles,
  User,
  UserCheck,
  Users,
} from "lucide-react"

interface Props {
  clientId: string
}

const NAV_TABS = [
  "Overview",
  "Packets",
  "Documents",
  "Services",
  "Care Team",
  "Tasks",
  "Signatures",
  "Validation",
  "Audit",
  "Timeline",
  "Notes",
  "Overflow",
]

export async function ClientProfileContent({ clientId }: Props) {
  let client: Awaited<ReturnType<typeof getClientById>>
  let programs: Awaited<ReturnType<typeof getPrograms>> = []
  let staff: Awaited<ReturnType<typeof getAvailableStaff>> = []

  try {
    client = await getClientById(clientId)
    if (client) {
      [programs, staff] = await Promise.all([
        getPrograms(client.organizationId),
        getAvailableStaff(client.organizationId),
      ])
    }
  } catch (e) {
    return (
      <div className="space-y-6">
        <ErrorState
          title="Access Denied"
          description="You do not have permission to view this client's profile."
          error={e instanceof Error ? e.message : "Access denied"}
        />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="space-y-6">
        <EmptyState
          title="Client not found"
          description="This client does not exist or has been removed."
          icon={<User className="h-8 w-8" />}
        />
      </div>
    )
  }

  const fullName = `${client.firstName} ${client.lastName}`
  const activePackets = client.packets.filter((packet) => !["completed", "approved", "archived"].includes(packet.status))
  const activePacket = activePackets[0] ?? client.packets[0]
  const completedPackets = client.packets.filter((packet) => ["completed", "approved"].includes(packet.status)).length
  const pendingSignatures = client.packets.filter((packet) => packet.status === "awaiting_signature").length
  const validationIssues = client.packets.filter((packet) => ["needs_validation", "validation_failed"].includes(packet.status)).length
  const overduePackets = client.packets.filter((packet) => packet.dueDate && new Date(packet.dueDate) < new Date() && !packet.completedAt).length
  const upcomingReviews = client.packets.filter((packet) => packet.dueDate && new Date(packet.dueDate) >= new Date()).length
  const openTasks = activePackets.length + validationIssues + pendingSignatures + overduePackets
  const complianceScore = scoreFrom(client.packets.length ? Math.round((completedPackets / client.packets.length) * 100) : 82, validationIssues * 8 + overduePackets * 6)
  const auditReadiness = scoreFrom(complianceScore, pendingSignatures * 5)
  const aiRiskScore = Math.min(100, 18 + validationIssues * 18 + overduePackets * 14 + Math.max(0, client.diagnoses.length - 1) * 6)
  const primaryProgram = client.enrollments[0]?.program.name ?? "Not assigned"
  const admissionDate = client.enrollments[0]?.startDate ?? client.createdAt
  const primaryDiagnosis = client.diagnoses.find((dx) => dx.type === "primary") ?? client.diagnoses[0]
  const secondaryDiagnosis = client.diagnoses.find((dx) => dx.type === "secondary") ?? client.diagnoses[1]
  const caseManager = client.assignments.find((assignment) => assignment.role.toLowerCase().includes("case")) ?? client.assignments.find((assignment) => assignment.isPrimary)
  const coordinator = client.assignments.find((assignment) => assignment.role.toLowerCase().includes("coordinator"))
  const guardian = client.contacts.find((contact) => contact.isGuardian)
  const location = [client.city, client.state].filter(Boolean).join(", ") || "Location not set"
  const documentCount = client.packets.length
  const recentDocuments = client.packets.slice(0, 4)
  const recentEvents = buildTimeline(client)

  const kpis = [
    { label: "Active Packets", value: activePackets.length, trend: "+2 this month", tone: "brand", bars: [35, 52, 44, 68, 76] },
    { label: "Compliance Score", value: `${complianceScore}%`, trend: complianceScore >= 80 ? "Healthy" : "Needs attention", tone: complianceScore >= 80 ? "success" : "warning", bars: [70, 74, 78, complianceScore - 8, complianceScore] },
    { label: "Open Tasks", value: openTasks, trend: `${overduePackets} overdue`, tone: overduePackets ? "danger" : "warning", bars: [28, 48, 36, 52, 40] },
    { label: "Pending Signatures", value: pendingSignatures, trend: "Signature queue", tone: pendingSignatures ? "warning" : "success", bars: [18, 24, 20, 28, 16] },
    { label: "Validation Issues", value: validationIssues, trend: validationIssues ? "Review required" : "Clear", tone: validationIssues ? "danger" : "success", bars: [16, 22, 14, 10, validationIssues ? 34 : 8] },
    { label: "Upcoming Reviews", value: upcomingReviews, trend: "Next 90 days", tone: "brand", bars: [22, 30, 28, 42, 36] },
    { label: "Audit Readiness", value: `${auditReadiness}%`, trend: auditReadiness >= 80 ? "Audit ready" : "Tighten files", tone: auditReadiness >= 80 ? "success" : "warning", bars: [64, 68, 72, auditReadiness - 5, auditReadiness] },
    { label: "AI Risk Score", value: aiRiskScore, trend: aiRiskScore >= 70 ? "High risk" : aiRiskScore >= 40 ? "Moderate" : "Low risk", tone: aiRiskScore >= 70 ? "danger" : aiRiskScore >= 40 ? "warning" : "success", bars: [22, 30, 26, 36, aiRiskScore] },
  ] as const

  return (
    <div className="space-y-5 pb-6">
      <ClientHeader
        client={client}
        fullName={fullName}
        primaryProgram={primaryProgram}
        admissionDate={admissionDate}
        primaryDiagnosis={primaryDiagnosis?.description || primaryDiagnosis?.code || "Not recorded"}
        secondaryDiagnosis={secondaryDiagnosis?.description || secondaryDiagnosis?.code || "Not recorded"}
        caseManager={caseManager?.staff.name || caseManager?.staff.email || "Unassigned"}
        coordinator={coordinator?.staff.name || coordinator?.staff.email || "Unassigned"}
        guardian={guardian ? `${guardian.firstName} ${guardian.lastName}` : "Not recorded"}
        location={location}
        activePacket={activePacket}
        aiRiskScore={aiRiskScore}
      />

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        {kpis.map((kpi) => (
          <KpiCard key={kpi.label} {...kpi} />
        ))}
      </section>

      <ClientTabs />

      <div className="grid gap-5 xl:grid-cols-[minmax(0,7fr)_minmax(320px,3fr)]">
        <main className="min-w-0 space-y-5">
          <section className="grid gap-5 2xl:grid-cols-[minmax(0,1.35fr)_minmax(360px,0.65fr)]">
            <ActivePackets packets={client.packets} activePacketId={activePacket?.id} />
            <ComplianceSummary
              complianceScore={complianceScore}
              missingDocuments={Math.max(0, 4 - documentCount)}
              missingSignatures={pendingSignatures}
              upcomingReviews={upcomingReviews}
              validationFailures={validationIssues}
              auditFindings={overduePackets}
            />
          </section>

          <section className="grid gap-5 2xl:grid-cols-2">
            <DocumentOverview packets={recentDocuments} documentCount={documentCount} />
            <ServicesOverview enrollments={client.enrollments} programsAvailable={programs.length} />
          </section>

          <section className="grid gap-5 2xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <CareTeam assignments={client.assignments} contacts={client.contacts} availableStaff={staff.length} />
            <ActivityTimeline events={recentEvents} />
          </section>

          <RelationshipGraph
            packetCount={client.packets.length}
            documentCount={documentCount}
            validationIssues={validationIssues}
            pendingSignatures={pendingSignatures}
            auditFindings={overduePackets}
          />

          <section className="grid gap-5 2xl:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
            <RiskCompliance
              aiRiskScore={aiRiskScore}
              complianceScore={complianceScore}
              auditReadiness={auditReadiness}
              validationIssues={validationIssues}
              overduePackets={overduePackets}
              pendingSignatures={pendingSignatures}
            />
            <ClientSearch fullName={fullName} />
          </section>

          {client.notes && (
            <Card>
              <CardHeader className="pb-3">
                <SectionTitle icon={<MessageSquareText className="h-5 w-5" />} title="Notes" subtitle="Existing client notes" />
              </CardHeader>
              <CardContent>
                <p className="whitespace-pre-wrap text-sm leading-6 text-surface-600">{client.notes}</p>
              </CardContent>
            </Card>
          )}
        </main>

        <AiAssistantSidebar
          fullName={fullName}
          clientId={client.id}
          activePacket={activePacket}
          complianceScore={complianceScore}
          auditReadiness={auditReadiness}
          aiRiskScore={aiRiskScore}
          validationIssues={validationIssues}
          pendingSignatures={pendingSignatures}
          upcomingReviews={upcomingReviews}
        />
      </div>

      <FooterStatus
        clientId={clientId}
        organizationName={client.organization.name}
        updatedAt={client.updatedAt}
        status={client.status}
        packetCount={client.packets.length}
        staffCount={client.assignments.length}
      />
    </div>
  )
}

function ClientHeader({
  client,
  fullName,
  primaryProgram,
  admissionDate,
  primaryDiagnosis,
  secondaryDiagnosis,
  caseManager,
  coordinator,
  guardian,
  location,
  activePacket,
  aiRiskScore,
}: {
  client: NonNullable<Awaited<ReturnType<typeof getClientById>>>
  fullName: string
  primaryProgram: string
  admissionDate: Date | string
  primaryDiagnosis: string
  secondaryDiagnosis: string
  caseManager: string
  coordinator: string
  guardian: string
  location: string
  activePacket?: { id: string } | null
  aiRiskScore: number
}) {
  const highRisk = aiRiskScore >= 70

  return (
    <header className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm text-surface-500">
        <Link href="/clients" className="font-medium hover:text-brand-700">Clients</Link>
        <span>&gt;</span>
        <span className="font-semibold text-surface-800">Client Profile</span>
      </div>

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col gap-5 p-5 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-col gap-5 lg:flex-row lg:items-center">
              <Avatar size="xl" className="h-24 w-24 rounded-2xl shadow-sm ring-4 ring-brand-50">
                <AvatarFallback className="rounded-2xl bg-brand-100 text-2xl font-bold text-brand-700" name={fullName} />
              </Avatar>

              <div className="min-w-0 space-y-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-3xl font-semibold tracking-tight text-surface-950">{fullName}</h1>
                    <StatusChip status={client.status} size="md" />
                    <Badge variant="info" size="sm">HIPAA Protected</Badge>
                    <Badge variant={highRisk ? "danger" : "warning"} size="sm">High Risk</Badge>
                    <Badge variant="success" size="sm">Audit Ready</Badge>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3 text-sm text-surface-500">
                    <span className="inline-flex items-center gap-1.5">
                      <ShieldCheck className="h-4 w-4 text-brand-600" />
                      245D ID: <strong className="text-surface-800">{client.mcadId || "Not assigned"}</strong>
                    </span>
                    {client.email && <span className="inline-flex items-center gap-1.5"><Mail className="h-4 w-4" />{client.email}</span>}
                    {client.phone && <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{client.phone}</span>}
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <IdentityMetric label="DOB" value={client.dateOfBirth ? formatDate(client.dateOfBirth) : "Not recorded"} />
                  <IdentityMetric label="Program" value={primaryProgram} />
                  <IdentityMetric label="Admission" value={formatDate(admissionDate)} />
                  <IdentityMetric label="Primary Diagnosis" value={primaryDiagnosis} />
                  <IdentityMetric label="Secondary Diagnosis" value={secondaryDiagnosis} />
                </div>
              </div>
            </div>

            <div className="flex shrink-0 flex-wrap gap-2 xl:justify-end">
              <Link href={`/packets/new?clientId=${client.id}`}>
                <Button size="sm"><Plus className="h-4 w-4" />Start New Packet</Button>
              </Link>
              <Link href={`/clients/${client.id}/edit`}>
                <Button variant="secondary" size="sm"><Edit className="h-4 w-4" />Edit Client</Button>
              </Link>
              {activePacket ? (
                <Link href={`/packets/${activePacket.id}`}>
                  <Button variant="secondary" size="sm"><FolderOpen className="h-4 w-4" />Open Active Packet</Button>
                </Link>
              ) : (
                <Button variant="secondary" size="sm" disabled><FolderOpen className="h-4 w-4" />Open Active Packet</Button>
              )}
              <Button variant="secondary" size="sm" disabled title="PDF editor requires a packet document id from the existing workflow">
                <FileText className="h-4 w-4" />Open PDF Editor
              </Button>
              <Button variant="secondary" size="sm" disabled title="Export is presentation-only in this UI pass">
                <Download className="h-4 w-4" />Export Summary
              </Button>
              <Button variant="ghost" size="icon-sm" title="More actions"><MoreHorizontal className="h-4 w-4" /></Button>
            </div>
          </div>

          <div className="grid border-t border-surface-200 bg-surface-50 px-5 py-3 sm:grid-cols-2 lg:grid-cols-5">
            <IdentityMetric compact label="Case Manager" value={caseManager} />
            <IdentityMetric compact label="Coordinator" value={coordinator} />
            <IdentityMetric compact label="Guardian" value={guardian} />
            <IdentityMetric compact label="Language" value={client.preferredLanguage || "Not recorded"} />
            <IdentityMetric compact label="Location" value={location} />
          </div>
        </CardContent>
      </Card>
    </header>
  )
}

function KpiCard({ label, value, trend, tone, bars }: { label: string; value: string | number; trend: string; tone: "brand" | "success" | "warning" | "danger"; bars: readonly number[] }) {
  return (
    <Card className="rounded-xl">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-surface-400">{label}</p>
            <p className="mt-2 text-2xl font-semibold text-surface-950">{value}</p>
          </div>
          <span className={cn("rounded-full px-2 py-1 text-[10px] font-semibold", toneClass(tone, "soft"))}>{trend}</span>
        </div>
        <div className="mt-4 flex h-8 items-end gap-1">
          {bars.map((bar, index) => (
            <span
              key={`${label}-${index}`}
              className={cn("flex-1 rounded-t-sm", toneClass(tone, "bar"))}
              style={{ height: `${Math.max(12, Math.min(100, bar))}%` }}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ClientTabs() {
  return (
    <Card className="overflow-hidden">
      <div className="flex overflow-x-auto px-3">
        {NAV_TABS.map((tab, index) => (
          <button
            key={tab}
            type="button"
            className={cn(
              "relative flex shrink-0 items-center gap-2 px-4 py-3 text-sm font-semibold transition-colors",
              index === 0 ? "text-brand-700" : "text-surface-500 hover:text-surface-800"
            )}
          >
            {tab}
            {tab === "Overflow" && <ChevronDown className="h-3.5 w-3.5" />}
            {index === 0 && <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-brand-600" />}
          </button>
        ))}
      </div>
    </Card>
  )
}

function ActivePackets({ packets, activePacketId }: { packets: NonNullable<Awaited<ReturnType<typeof getClientById>>>["packets"]; activePacketId?: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-3">
          <SectionTitle icon={<FolderOpen className="h-5 w-5" />} title="Active Packets" subtitle="Current packet workload" />
          <Link href="/packets"><Button variant="ghost" size="sm">View all</Button></Link>
        </div>
      </CardHeader>
      <CardContent>
        {packets.length === 0 ? (
          <EmptyPanel icon={<FolderOpen className="h-6 w-6" />} text="No packets yet" />
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {packets.slice(0, 4).map((packet) => {
              const completion = packet.completedAt ? 100 : packet.status === "approved" ? 100 : packet.status === "in_progress" ? 58 : packet.status === "awaiting_signature" ? 78 : 32
              const validation = ["needs_validation", "validation_failed"].includes(packet.status) ? "Needs review" : "Clear"
              const signatures = packet.status === "awaiting_signature" ? "Pending" : "Ready"
              return (
                <div key={packet.id} className={cn("rounded-xl border p-4 transition-colors", packet.id === activePacketId ? "border-brand-200 bg-brand-50" : "border-surface-200 bg-white hover:bg-surface-50")}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-surface-900">{labelize(packet.packetType)}</p>
                      <p className="mt-1 text-xs text-surface-500">Updated {formatDate(packet.updatedAt)}</p>
                    </div>
                    <StatusChip status={packet.status} size="sm" />
                  </div>
                  <Progress className="mt-4" value={completion} size="sm" showValue label="Completion" variant={completion >= 80 ? "success" : completion >= 50 ? "warning" : "default"} />
                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-surface-500">
                    <span>Validation: <strong className={validation === "Clear" ? "text-success-700" : "text-warning-700"}>{validation}</strong></span>
                    <span>Signatures: <strong className={signatures === "Ready" ? "text-success-700" : "text-warning-700"}>{signatures}</strong></span>
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <Link href={`/packets/${packet.id}`}><Button variant="secondary" size="sm">Open Packet</Button></Link>
                    <Button variant="ghost" size="sm" disabled title="PDF requires an existing packet document id">Open PDF</Button>
                    <Link href={`/packets/${packet.id}`}><Button variant="ghost" size="sm">Continue Editing</Button></Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ComplianceSummary({ complianceScore, missingDocuments, missingSignatures, upcomingReviews, validationFailures, auditFindings }: {
  complianceScore: number
  missingDocuments: number
  missingSignatures: number
  upcomingReviews: number
  validationFailures: number
  auditFindings: number
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<ClipboardCheck className="h-5 w-5" />} title="Compliance Summary" subtitle="Client readiness snapshot" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-col items-center gap-5">
          <CircularScore score={complianceScore} />
          <div className="grid w-full grid-cols-2 gap-3">
            <MetricPill label="Missing Documents" value={missingDocuments} tone={missingDocuments ? "warning" : "success"} />
            <MetricPill label="Missing Signatures" value={missingSignatures} tone={missingSignatures ? "warning" : "success"} />
            <MetricPill label="Upcoming Reviews" value={upcomingReviews} tone="brand" />
            <MetricPill label="Validation Failures" value={validationFailures} tone={validationFailures ? "danger" : "success"} />
            <MetricPill label="Audit Findings" value={auditFindings} tone={auditFindings ? "danger" : "success"} className="col-span-2" />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function DocumentOverview({ packets, documentCount }: { packets: NonNullable<Awaited<ReturnType<typeof getClientById>>>["packets"]; documentCount: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <SectionTitle icon={<FileText className="h-5 w-5" />} title="Document Overview" subtitle={`${documentCount} packet-linked records`} />
          <Link href="/library"><Button variant="ghost" size="sm">View all</Button></Link>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-3 gap-2">
          <MetricPill label="Recent Docs" value={packets.length} tone="brand" />
          <MetricPill label="Ready" value={packets.filter((packet) => ["completed", "approved"].includes(packet.status)).length} tone="success" />
          <MetricPill label="Needs Work" value={packets.filter((packet) => !["completed", "approved"].includes(packet.status)).length} tone="warning" />
        </div>
        <div className="space-y-2">
          {packets.length === 0 ? (
            <EmptyPanel icon={<FileText className="h-6 w-6" />} text="No recent documents" />
          ) : packets.map((packet) => (
            <div key={packet.id} className="flex items-center gap-3 rounded-lg border border-surface-200 bg-white p-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50">
                <FileText className="h-4 w-4 text-brand-600" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-surface-900">{labelize(packet.packetType)}</p>
                <p className="text-xs text-surface-500">Recent edit {formatDate(packet.updatedAt)}</p>
              </div>
              <StatusChip status={packet.status} size="sm" />
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function ServicesOverview({ enrollments, programsAvailable }: { enrollments: NonNullable<Awaited<ReturnType<typeof getClientById>>>["enrollments"]; programsAvailable: number }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<HeartPulse className="h-5 w-5" />} title="Services" subtitle={`${programsAvailable} programs available in organization`} />
      </CardHeader>
      <CardContent>
        {enrollments.length === 0 ? (
          <EmptyPanel icon={<HeartPulse className="h-6 w-6" />} text="No services enrolled" />
        ) : (
          <div className="space-y-3">
            {enrollments.map((enrollment, index) => {
              const progress = enrollment.status === "active" ? 72 : 38
              return (
                <div key={enrollment.id} className="rounded-xl border border-surface-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-surface-900">{enrollment.program.name}</p>
                      <p className="mt-1 text-xs text-surface-500">Review date {formatDate(enrollment.endDate ?? enrollment.startDate ?? new Date())}</p>
                    </div>
                    <StatusChip status={enrollment.status} size="sm" />
                  </div>
                  <p className="mt-3 text-xs text-surface-500">Goal {index + 1}: Maintain service plan progress and review readiness.</p>
                  <Progress className="mt-3" value={progress} size="sm" variant={progress >= 70 ? "success" : "warning"} showValue />
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function CareTeam({ assignments, contacts, availableStaff }: {
  assignments: NonNullable<Awaited<ReturnType<typeof getClientById>>>["assignments"]
  contacts: NonNullable<Awaited<ReturnType<typeof getClientById>>>["contacts"]
  availableStaff: number
}) {
  const guardianContacts = contacts.filter((contact) => contact.isGuardian)
  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<Users className="h-5 w-5" />} title="Care Team" subtitle={`${availableStaff} staff available`} />
      </CardHeader>
      <CardContent>
        {assignments.length === 0 && guardianContacts.length === 0 ? (
          <EmptyPanel icon={<Users className="h-6 w-6" />} text="No care team members assigned" />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-1">
            {assignments.map((assignment) => (
              <TeamCard
                key={assignment.id}
                name={assignment.staff.name || assignment.staff.email}
                role={labelize(assignment.role)}
                email={assignment.staff.email}
                phone="Phone not recorded"
                primary={assignment.isPrimary}
              />
            ))}
            {guardianContacts.map((contact) => (
              <TeamCard
                key={contact.id}
                name={`${contact.firstName} ${contact.lastName}`}
                role="Guardian"
                email={contact.email || "Email not recorded"}
                phone={contact.phone || "Phone not recorded"}
                primary={false}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ActivityTimeline({ events }: { events: TimelineEvent[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<History className="h-5 w-5" />} title="Activity Timeline" subtitle="Recent client activity" />
      </CardHeader>
      <CardContent>
        <div className="space-y-5">
          {["Today", "Yesterday", "Earlier"].map((group) => {
            const groupedEvents = events.filter((event) => event.group === group)
            if (groupedEvents.length === 0) return null
            return (
              <div key={group}>
                <p className="mb-3 text-xs font-bold uppercase tracking-wider text-surface-400">{group}</p>
                <div className="space-y-3 border-l border-surface-200 pl-4">
                  {groupedEvents.map((event) => (
                    <div key={event.id} className="relative">
                      <span className="absolute -left-[21px] top-1.5 h-3 w-3 rounded-full border-2 border-white bg-brand-500 shadow" />
                      <p className="text-sm font-semibold text-surface-900">{event.title}</p>
                      <p className="mt-1 text-xs text-surface-500">{event.description}</p>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      </CardContent>
    </Card>
  )
}

function RelationshipGraph({ packetCount, documentCount, validationIssues, pendingSignatures, auditFindings }: {
  packetCount: number
  documentCount: number
  validationIssues: number
  pendingSignatures: number
  auditFindings: number
}) {
  const nodes = [
    { label: "Client", value: 1, icon: <User className="h-4 w-4" /> },
    { label: "Packets", value: packetCount, icon: <FolderOpen className="h-4 w-4" /> },
    { label: "Documents", value: documentCount, icon: <FileText className="h-4 w-4" /> },
    { label: "Validation", value: validationIssues, icon: <ClipboardCheck className="h-4 w-4" /> },
    { label: "Signatures", value: pendingSignatures, icon: <Signature className="h-4 w-4" /> },
    { label: "Issues", value: validationIssues + auditFindings, icon: <ShieldAlert className="h-4 w-4" /> },
    { label: "Audit", value: auditFindings, icon: <History className="h-4 w-4" /> },
  ]

  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<LinkIcon />} title="Relationship Graph" subtitle="Client record dependency map" />
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap items-center gap-3">
          {nodes.map((node, index) => (
            <div key={node.label} className="flex items-center gap-3">
              <div className="rounded-xl border border-surface-200 bg-surface-50 p-3 text-center">
                <div className="mx-auto flex h-9 w-9 items-center justify-center rounded-lg bg-white text-brand-700 shadow-sm">{node.icon}</div>
                <p className="mt-2 text-lg font-semibold text-surface-900">{node.value}</p>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">{node.label}</p>
              </div>
              {index < nodes.length - 1 && <ArrowUpRight className="hidden h-4 w-4 text-surface-300 sm:block" />}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function RiskCompliance({ aiRiskScore, complianceScore, auditReadiness, validationIssues, overduePackets, pendingSignatures }: {
  aiRiskScore: number
  complianceScore: number
  auditReadiness: number
  validationIssues: number
  overduePackets: number
  pendingSignatures: number
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<ShieldAlert className="h-5 w-5" />} title="Risk & Compliance" subtitle="Operational risk signals" />
      </CardHeader>
      <CardContent className="space-y-3">
        <RiskRow label="AI Risk" value={aiRiskScore} tone={aiRiskScore >= 70 ? "danger" : aiRiskScore >= 40 ? "warning" : "success"} />
        <RiskRow label="Compliance Health" value={complianceScore} tone={complianceScore >= 80 ? "success" : "warning"} />
        <RiskRow label="Audit Readiness" value={auditReadiness} tone={auditReadiness >= 80 ? "success" : "warning"} />
        <div className="grid grid-cols-3 gap-2 pt-2">
          <MetricPill label="Validation" value={validationIssues} tone={validationIssues ? "danger" : "success"} />
          <MetricPill label="Overdue" value={overduePackets} tone={overduePackets ? "danger" : "success"} />
          <MetricPill label="Signatures" value={pendingSignatures} tone={pendingSignatures ? "warning" : "success"} />
        </div>
      </CardContent>
    </Card>
  )
}

function ClientSearch({ fullName }: { fullName: string }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <SectionTitle icon={<Search className="h-5 w-5" />} title="Search Within Client" subtitle="Presentation search surface" />
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3 rounded-xl border border-surface-200 bg-surface-50 px-4 py-3">
          <Search className="h-4 w-4 text-surface-400" />
          <span className="text-sm text-surface-500">Search packets, documents, notes, audit events...</span>
        </div>
        <div>
          <p className="mb-2 text-xs font-bold uppercase tracking-wider text-surface-400">Recent Searches</p>
          <div className="flex flex-wrap gap-2">
            {["support plan", "signature status", "validation", fullName.split(" ")[0]].map((term) => (
              <Badge key={term} variant="secondary" size="sm">{term}</Badge>
            ))}
          </div>
        </div>
        <Button variant="secondary" size="sm" disabled title="Advanced client search is presentation-only in this pass">Advanced Search</Button>
      </CardContent>
    </Card>
  )
}

function AiAssistantSidebar({ fullName, clientId, activePacket, complianceScore, auditReadiness, aiRiskScore, validationIssues, pendingSignatures, upcomingReviews }: {
  fullName: string
  clientId: string
  activePacket?: { id: string } | null
  complianceScore: number
  auditReadiness: number
  aiRiskScore: number
  validationIssues: number
  pendingSignatures: number
  upcomingReviews: number
}) {
  const recommendations = [
    { title: validationIssues ? "Resolve validation issues" : "Keep validation clear", confidence: validationIssues ? 94 : 88 },
    { title: pendingSignatures ? "Request pending signatures" : "Monitor signature readiness", confidence: pendingSignatures ? 91 : 82 },
    { title: upcomingReviews ? "Prepare upcoming review packet" : "Schedule next review check", confidence: 79 },
  ]

  return (
    <aside className="space-y-5 xl:sticky xl:top-5 xl:self-start">
      <Card className="border-brand-100 bg-gradient-to-b from-brand-50 to-white">
        <CardHeader className="pb-3">
          <SectionTitle icon={<Bot className="h-5 w-5" />} title="Higsi AI Assistant" subtitle="Enterprise client assistant" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-xl border border-brand-100 bg-white p-4">
            <p className="text-sm font-semibold text-surface-900">Client Health Summary</p>
            <p className="mt-2 text-sm leading-6 text-surface-600">
              {fullName} is tracking at {complianceScore}% compliance with {validationIssues} validation issue{validationIssues === 1 ? "" : "s"} and {pendingSignatures} pending signature item{pendingSignatures === 1 ? "" : "s"}.
            </p>
          </div>

          <div className="grid grid-cols-3 gap-2">
            <MetricPill label="Risk" value={aiRiskScore} tone={aiRiskScore >= 70 ? "danger" : aiRiskScore >= 40 ? "warning" : "success"} />
            <MetricPill label="Health" value={complianceScore} tone={complianceScore >= 80 ? "success" : "warning"} />
            <MetricPill label="Audit" value={auditReadiness} tone={auditReadiness >= 80 ? "success" : "warning"} />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-surface-400">Checklist</p>
            {["Demographics verified", "Packet status reviewed", "Validation monitored", "Signature queue checked"].map((item, index) => (
              <div key={item} className="flex items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm">
                <CheckCircle2 className={cn("h-4 w-4", index < 2 ? "text-success-500" : "text-warning-500")} />
                <span className="text-surface-700">{item}</span>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-bold uppercase tracking-wider text-surface-400">AI Recommendations</p>
            {recommendations.map((item) => (
              <div key={item.title} className="rounded-lg border border-surface-200 bg-white p-3">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-surface-800">{item.title}</p>
                  <Badge variant="default" size="sm">{item.confidence}%</Badge>
                </div>
              </div>
            ))}
          </div>

          <Link href="/ai-copilot">
            <Button className="w-full" size="sm"><Sparkles className="h-4 w-4" />Ask Higsi AI</Button>
          </Link>
          <div className="grid gap-2">
            <Button variant="secondary" size="sm" disabled title="Uses existing AI/reporting workflow when available">Generate Executive Summary</Button>
            <Button variant="secondary" size="sm" disabled title="No new AI action added in this UI pass">Explain Compliance Score</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <SectionTitle icon={<ZapIcon />} title="Quick Actions" subtitle="Common client workflows" />
        </CardHeader>
        <CardContent className="grid gap-2">
          <Link href="/packets/new"><QuickAction icon={<Plus className="h-4 w-4" />} label="Start Packet" /></Link>
          {activePacket ? <Link href={`/packets/${activePacket.id}`}><QuickAction icon={<FolderOpen className="h-4 w-4" />} label="Open Packet" /></Link> : <QuickAction icon={<FolderOpen className="h-4 w-4" />} label="Open Packet" disabled />}
          <QuickAction icon={<FileText className="h-4 w-4" />} label="Upload" disabled />
          <QuickAction icon={<FileSearch className="h-4 w-4" />} label="Open PDF" disabled />
          <Link href="/signatures"><QuickAction icon={<Signature className="h-4 w-4" />} label="Request Signature" /></Link>
          <Link href="/validation"><QuickAction icon={<ClipboardCheck className="h-4 w-4" />} label="Run Validation" /></Link>
          <Link href="/reports"><QuickAction icon={<BarChart3 className="h-4 w-4" />} label="Generate Report" /></Link>
          <Link href="/audit"><QuickAction icon={<History className="h-4 w-4" />} label="View Audit" /></Link>
          <Link href={`/clients/${clientId}/portal-access`}><QuickAction icon={<UserCheck className="h-4 w-4" />} label="Portal Access" /></Link>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <SectionTitle icon={<Sparkles className="h-5 w-5" />} title="Next Best Actions" subtitle="Ranked recommendations" />
        </CardHeader>
        <CardContent className="space-y-3">
          {recommendations.map((item, index) => (
            <div key={`nba-${item.title}`} className="flex gap-3 rounded-xl border border-surface-200 bg-white p-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-50 text-xs font-bold text-brand-700">{index + 1}</div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-surface-900">{item.title}</p>
                <p className="text-xs text-surface-500">Confidence {item.confidence}%</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </aside>
  )
}

function FooterStatus({ clientId, organizationName, updatedAt, status, packetCount, staffCount }: {
  clientId: string
  organizationName: string
  updatedAt: Date | string
  status: string
  packetCount: number
  staffCount: number
}) {
  return (
    <footer className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-surface-200 bg-white px-4 py-3 text-xs text-surface-500 shadow-sm">
      <div className="flex flex-wrap items-center gap-4">
        <span>Client ID <strong className="text-surface-800">{clientId}</strong></span>
        <span>Organization <strong className="text-surface-800">{organizationName}</strong></span>
        <span>Last updated <strong className="text-surface-800">{formatDateTime(updatedAt)}</strong></span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span>Status <strong className="capitalize text-success-700">{status}</strong></span>
        <span>Packets <strong className="text-surface-800">{packetCount}</strong></span>
        <span>Care Team <strong className="text-surface-800">{staffCount}</strong></span>
        <span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-success-500" />Tenant scoped</span>
      </div>
    </footer>
  )
}

function IdentityMetric({ label, value, compact }: { label: string; value: string; compact?: boolean }) {
  return (
    <div className={cn("min-w-0", compact ? "py-1" : "rounded-lg border border-surface-200 bg-surface-50 px-3 py-2")}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-surface-400">{label}</p>
      <p className={cn("mt-1 truncate font-semibold text-surface-800", compact ? "text-sm" : "text-xs")}>{value}</p>
    </div>
  )
}

function SectionTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle?: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">{icon}</div>
      <div className="min-w-0">
        <CardTitle className="truncate text-base">{title}</CardTitle>
        {subtitle && <p className="mt-0.5 truncate text-xs text-surface-500">{subtitle}</p>}
      </div>
    </div>
  )
}

function CircularScore({ score }: { score: number }) {
  return (
    <div
      className="relative flex h-44 w-44 items-center justify-center rounded-full p-3"
      style={{ background: "conic-gradient(var(--color-brand-600), var(--color-success-500), var(--color-surface-200))" }}
    >
      <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-white shadow-inner">
        <span className="text-4xl font-semibold text-surface-950">{score}%</span>
        <span className="mt-1 text-xs font-semibold uppercase tracking-wider text-surface-400">Score</span>
      </div>
    </div>
  )
}

function MetricPill({ label, value, tone, className }: { label: string; value: string | number; tone: "brand" | "success" | "warning" | "danger"; className?: string }) {
  return (
    <div className={cn("rounded-xl border bg-white p-3", toneBorder(tone), className)}>
      <p className="text-[10px] font-bold uppercase tracking-wider text-surface-400">{label}</p>
      <p className={cn("mt-1 text-xl font-semibold", toneClass(tone, "text"))}>{value}</p>
    </div>
  )
}

function TeamCard({ name, role, email, phone, primary }: { name: string; role: string; email: string; phone: string; primary: boolean }) {
  return (
    <div className="rounded-xl border border-surface-200 bg-white p-3">
      <div className="flex items-start gap-3">
        <Avatar size="md">
          <AvatarFallback className="bg-brand-100 text-brand-700" name={name} />
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-semibold text-surface-900">{name}</p>
            {primary && <Badge variant="info" size="sm">Primary</Badge>}
          </div>
          <p className="text-xs text-surface-500">{role}</p>
          <p className="mt-1 truncate text-xs text-surface-500">{email}</p>
          <p className="truncate text-xs text-surface-500">{phone}</p>
        </div>
      </div>
    </div>
  )
}

function RiskRow({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "danger" }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span className="font-medium text-surface-700">{label}</span>
        <span className={cn("font-semibold", toneClass(tone, "text"))}>{value}%</span>
      </div>
      <Progress value={value} size="sm" variant={tone} />
    </div>
  )
}

function QuickAction({ icon, label, disabled }: { icon: ReactNode; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      disabled={disabled}
      className="flex w-full items-center justify-between rounded-xl border border-surface-200 bg-white px-3 py-2 text-sm font-semibold text-surface-700 transition-colors hover:bg-surface-50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <span className="inline-flex items-center gap-2">{icon}{label}</span>
      <ArrowUpRight className="h-3.5 w-3.5 text-surface-400" />
    </button>
  )
}

function EmptyPanel({ icon, text }: { icon: ReactNode; text: string }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-surface-200 bg-surface-50 py-8 text-center">
      <div className="mb-2 text-surface-300">{icon}</div>
      <p className="text-sm text-surface-500">{text}</p>
    </div>
  )
}

type TimelineEvent = {
  id: string
  group: "Today" | "Yesterday" | "Earlier"
  title: string
  description: string
}

function buildTimeline(client: NonNullable<Awaited<ReturnType<typeof getClientById>>>): TimelineEvent[] {
  const packetEvents = client.packets.slice(0, 3).map((packet, index) => ({
    id: packet.id,
    group: index === 0 ? "Today" as const : index === 1 ? "Yesterday" as const : "Earlier" as const,
    title: `${labelize(packet.packetType)} updated`,
    description: `${labelize(packet.status)} - ${formatDate(packet.updatedAt)}`,
  }))

  return [
    ...packetEvents,
    {
      id: "client-updated",
      group: "Earlier",
      title: "Client profile updated",
      description: `Record updated ${formatDate(client.updatedAt)}`,
    },
    {
      id: "client-created",
      group: "Earlier",
      title: "Client admitted to Higsi",
      description: `Created ${formatDate(client.createdAt)}`,
    },
  ]
}

function labelize(value: string | null | undefined) {
  if (!value) return "Unknown"
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function scoreFrom(base: number, penalty: number) {
  return Math.max(0, Math.min(100, base - penalty))
}

function toneBorder(tone: "brand" | "success" | "warning" | "danger") {
  return {
    brand: "border-brand-100",
    success: "border-success-100",
    warning: "border-warning-100",
    danger: "border-danger-100",
  }[tone]
}

function toneClass(tone: "brand" | "success" | "warning" | "danger", surface: "soft" | "bar" | "text") {
  const map = {
    brand: {
      soft: "bg-brand-50 text-brand-700",
      bar: "bg-brand-500",
      text: "text-brand-700",
    },
    success: {
      soft: "bg-success-50 text-success-700",
      bar: "bg-success-500",
      text: "text-success-700",
    },
    warning: {
      soft: "bg-warning-50 text-warning-700",
      bar: "bg-warning-500",
      text: "text-warning-700",
    },
    danger: {
      soft: "bg-danger-50 text-danger-700",
      bar: "bg-danger-500",
      text: "text-danger-700",
    },
  }
  return map[tone][surface]
}

function LinkIcon() {
  return <Activity className="h-5 w-5" />
}

function ZapIcon() {
  return <Sparkles className="h-5 w-5" />
}
