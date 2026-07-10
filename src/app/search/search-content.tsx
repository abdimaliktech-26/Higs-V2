import Link from "next/link"
import type { ReactNode } from "react"
import { getClients } from "@/lib/actions/client"
import { getPackets } from "@/lib/actions/templates"
import { getLibraryDocuments } from "@/lib/actions/library"
import { getAuditEvents } from "@/lib/actions/audit"
import { getValidationResults } from "@/lib/actions/validation"
import { getSignatureRequests } from "@/lib/actions/signatures"
import { getApprovalRequests } from "@/lib/actions/approvals"
import { getAiRecommendations } from "@/lib/actions/ai"
import { getOrgUsers } from "@/lib/actions/users"
import { fromApprovals, fromPackets, fromSignatures, fromValidations, type WorkItem } from "@/app/tasks/work-queue-data"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Progress } from "@/components/ui/progress"
import { Donut } from "@/components/ui/charts"
import { cn, formatDate, timeAgo, truncate } from "@/lib/utils"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  BrainCircuit,
  Building2,
  CheckCircle2,
  ChevronRight,
  Circle,
  ClipboardList,
  Clock,
  Command,
  Download,
  ExternalLink,
  Eye,
  FileCheck2,
  FileSearch,
  FileSignature,
  FileText,
  Filter,
  FolderOpen,
  Gauge,
  History,
  Keyboard,
  LayoutDashboard,
  Lightbulb,
  ListChecks,
  Lock,
  MessageSquare,
  Mic,
  MoreHorizontal,
  PenSquare,
  Plus,
  Radio,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Star,
  Upload,
  UserPlus,
  Users,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react"

const NOT_WIRED = "Coming Soon - no backend source for this control yet"

type SearchParams = Record<string, string | string[] | undefined>
type ClientRow = Awaited<ReturnType<typeof getClients>>["clients"][number]
type PacketRow = Awaited<ReturnType<typeof getPackets>>["packets"][number]
type LibraryRows = Awaited<ReturnType<typeof getLibraryDocuments>>
type PacketDocumentRow = LibraryRows["packetDocs"][number]
type TemplateDocumentRow = LibraryRows["templates"][number]
type SupportingDocumentRow = LibraryRows["supportingDocs"][number]
type ValidationRow = Awaited<ReturnType<typeof getValidationResults>>["results"][number]
type AuditRow = Awaited<ReturnType<typeof getAuditEvents>>["events"][number]
type SignatureRow = Awaited<ReturnType<typeof getSignatureRequests>>["requests"][number]
type AiRecommendationRow = Awaited<ReturnType<typeof getAiRecommendations>>[number]
type MemberRow = Awaited<ReturnType<typeof getOrgUsers>>[number]

type GroupId =
  | "clients"
  | "packets"
  | "documents"
  | "validation"
  | "tasks"
  | "audit"
  | "reports"
  | "signatures"
  | "ai"

type Tone = "brand" | "success" | "warning" | "danger" | "info" | "purple" | "navy" | "slate"

interface ResultMeta {
  label: string
  value: string
}

interface ResultAction {
  label: string
  href?: string
  icon: LucideIcon
  disabled?: boolean
}

interface SearchResult {
  key: string
  id: string
  groupId: GroupId
  groupLabel: string
  icon: LucideIcon
  tone: Tone
  title: string
  subtitle: string
  description?: string
  href?: string
  status?: string
  badges: string[]
  updatedAt?: Date | string | null
  confidence?: number
  meta: ResultMeta[]
  actions: ResultAction[]
  progress?: number
  sourceLabel: string
}

interface ResultGroup {
  id: GroupId
  label: string
  icon: LucideIcon
  route?: string
  count: number
  results: SearchResult[]
  emptyTitle: string
  emptyDescription: string
  disabled?: boolean
}

interface Props {
  orgId: string
  searchParams: SearchParams
}

export async function SearchContent({ orgId, searchParams }: Props) {
  const query = normalizeParam(searchParams.q).trim()
  const activeScope = (normalizeParam(searchParams.scope) || "all") as GroupId | "all"
  const selectedKey = normalizeParam(searchParams.selected)

  let clientsRes: Awaited<ReturnType<typeof getClients>>
  let packetsRes: Awaited<ReturnType<typeof getPackets>>
  let libraryRows: Awaited<ReturnType<typeof getLibraryDocuments>>
  let auditRes: Awaited<ReturnType<typeof getAuditEvents>>
  let validationsRes: Awaited<ReturnType<typeof getValidationResults>>
  let signaturesRes: Awaited<ReturnType<typeof getSignatureRequests>>
  let approvalsRes: Awaited<ReturnType<typeof getApprovalRequests>>
  let aiRecommendations: Awaited<ReturnType<typeof getAiRecommendations>>
  let members: Awaited<ReturnType<typeof getOrgUsers>>

  try {
    [
      clientsRes,
      packetsRes,
      libraryRows,
      auditRes,
      validationsRes,
      signaturesRes,
      approvalsRes,
      aiRecommendations,
      members,
    ] = await Promise.all([
      getClients(orgId, { search: query || undefined, pageSize: 6 }),
      getPackets(orgId, { search: query || undefined, pageSize: 6 }),
      getLibraryDocuments(orgId, { tab: "active", search: query || undefined }),
      getAuditEvents(orgId, { search: query || undefined, pageSize: 6 }),
      getValidationResults(orgId, { pageSize: 50 }),
      getSignatureRequests(orgId, { pageSize: 50 }),
      getApprovalRequests(orgId, { pageSize: 50 }),
      getAiRecommendations(orgId, { status: "open" }),
      getOrgUsers(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error loading global search" description={(e as Error).message} />
  }

  const clientResults = clientsRes.clients.map((client) => clientToResult(client, query))
  const packetResults = packetsRes.packets.map((packet) => packetToResult(packet, query))
  const documentResults = buildDocumentResults(libraryRows, query).slice(0, 6)
  const validationResults = validationsRes.results
    .filter((row) => matchesQuery(validationSearchText(row), query))
    .slice(0, 6)
    .map((row) => validationToResult(row, query))
  const workItems = [
    ...fromPackets(packetsRes.packets),
    ...fromSignatures(signaturesRes.requests),
    ...fromApprovals(approvalsRes.requests),
    ...fromValidations(validationsRes.results),
  ]
  const taskResults = workItems
    .filter((item) => matchesQuery(workItemSearchText(item), query))
    .slice(0, 6)
    .map((item) => workItemToResult(item, query))
  const auditResults = auditRes.events.map((event) => auditToResult(event, query))
  const signatureResults = signaturesRes.requests
    .filter((row) => matchesQuery(signatureSearchText(row), query))
    .slice(0, 6)
    .map((row) => signatureToResult(row, query))
  const aiResults = aiRecommendations
    .filter((row) => matchesQuery(aiSearchText(row), query))
    .slice(0, 6)
    .map((row) => aiToResult(row, query))

  const groups: ResultGroup[] = [
    {
      id: "clients",
      label: "Clients",
      icon: Users,
      route: listRoute("/clients", query),
      count: clientsRes.total,
      results: clientResults,
      emptyTitle: "No client matches",
      emptyDescription: "Client search uses existing client name, email, and MA ID fields.",
    },
    {
      id: "packets",
      label: "Packets",
      icon: FolderOpen,
      route: listRoute("/packets", query),
      count: packetsRes.total,
      results: packetResults,
      emptyTitle: "No packet matches",
      emptyDescription: "Packet search uses existing packet type and client name fields.",
    },
    {
      id: "documents",
      label: "Documents",
      icon: FileText,
      route: listRoute("/library", query),
      count: documentResults.length,
      results: documentResults,
      emptyTitle: "No document matches",
      emptyDescription: "Document results reuse the existing library and PDF editor records.",
    },
    {
      id: "validation",
      label: "Validation Issues",
      icon: ShieldAlert,
      route: "/validation",
      count: validationResults.length,
      results: validationResults,
      emptyTitle: "No validation matches",
      emptyDescription: "Validation rows are filtered from existing validation results.",
    },
    {
      id: "tasks",
      label: "Tasks",
      icon: ListChecks,
      route: "/tasks",
      count: taskResults.length,
      results: taskResults,
      emptyTitle: "No task matches",
      emptyDescription: "Task results reuse the existing Task & Work Queue sources.",
    },
    {
      id: "audit",
      label: "Audit Events",
      icon: Activity,
      route: listRoute("/audit", query),
      count: auditRes.total,
      results: auditResults,
      emptyTitle: "No audit matches",
      emptyDescription: "Audit search uses the existing audit event search fields.",
    },
    {
      id: "reports",
      label: "Reports",
      icon: BarChart3,
      route: "/reports",
      count: 0,
      results: [],
      emptyTitle: "Report search is Coming Soon",
      emptyDescription: "The Reports page is available, but there is no safe read-only global report search source.",
      disabled: true,
    },
    {
      id: "signatures",
      label: "Signatures",
      icon: FileSignature,
      route: "/signatures",
      count: signatureResults.length,
      results: signatureResults,
      emptyTitle: "No signature matches",
      emptyDescription: "Signature results reuse existing signature request records.",
    },
    {
      id: "ai",
      label: "AI Insights",
      icon: BrainCircuit,
      route: "/ai-copilot",
      count: aiResults.length,
      results: aiResults,
      emptyTitle: "No AI insight matches",
      emptyDescription: "Existing AI recommendations are shown when present. Conversational search is Coming Soon.",
    },
  ]

  const visibleGroups = activeScope === "all"
    ? groups.filter((group) => ["clients", "packets", "documents", "validation", "tasks", "audit"].includes(group.id))
    : groups.filter((group) => group.id === activeScope)
  const allResults = groups.flatMap((group) => group.results)
  const selectedResult = allResults.find((result) => result.key === selectedKey) ?? allResults[0] ?? null
  const totalVisibleResults = visibleGroups.reduce((sum, group) => sum + group.results.length, 0)
  const selectedDocument = selectedResult?.groupId === "documents" ? selectedResult : documentResults[0] ?? null

  return (
    <div className="overflow-hidden rounded-2xl border border-surface-200 bg-white shadow-[0_18px_48px_rgba(15,23,42,0.08)]">
      <SearchHeader query={query} activeScope={activeScope} />
      <SearchScopeRow groups={groups} activeScope={activeScope} query={query} />

      <div className="grid border-t border-surface-200 xl:grid-cols-[260px_minmax(0,1fr)] 2xl:grid-cols-[260px_minmax(0,1fr)_340px_304px]">
        <SearchSidebar query={query} members={members} selectedResult={selectedResult} />
        <ResultsPanel
          query={query}
          activeScope={activeScope}
          groups={visibleGroups}
          totalVisibleResults={totalVisibleResults}
          selectedKey={selectedResult?.key}
        />
        <InspectorPanel result={selectedResult} selectedDocument={selectedDocument} query={query} />
        <AiAssistantPanel
          query={query}
          groups={groups}
          recommendations={aiRecommendations}
          totalResults={allResults.length}
        />
      </div>

      <BottomAnalytics query={query} totalResults={allResults.length} workItems={workItems} />
    </div>
  )
}

function SearchHeader({ query, activeScope }: { query: string; activeScope: GroupId | "all" }) {
  return (
    <div className="bg-[#f8fbff] px-5 py-5 lg:px-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white shadow-sm">
              <Search className="h-4 w-4" />
            </span>
            <h1 className="text-[22px] font-bold tracking-tight text-navy-950">Global Search &amp; Command Center</h1>
          </div>
          <p className="mt-1 text-xs font-semibold text-navy-600">Search clients, packets, PDFs, reports, tasks, audit events, and compliance workflows.</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="hidden rounded-md border border-surface-200 bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-surface-500 sm:inline-flex">
            Esc Close
          </span>
          <Link href="/dashboard" className="flex h-8 w-8 items-center justify-center rounded-md border border-surface-200 bg-white text-surface-500 shadow-sm hover:bg-surface-50" aria-label="Close global search">
            <X className="h-4 w-4" />
          </Link>
        </div>
      </div>

      <form action="/search" className="mx-auto mt-5 max-w-4xl">
        {activeScope !== "all" && <input type="hidden" name="scope" value={activeScope} />}
        <div className="flex items-center gap-3 rounded-2xl border border-brand-200 bg-white p-2 shadow-[0_22px_46px_rgba(37,99,235,0.16)]">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-brand-50 text-brand-700">
            <Command className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <label className="sr-only" htmlFor="global-command-search">Search everywhere</label>
            <input
              id="global-command-search"
              name="q"
              defaultValue={query}
              placeholder="Search everywhere..."
              className="h-12 w-full border-0 bg-transparent text-lg font-semibold text-navy-950 outline-none placeholder:text-surface-400"
            />
          </div>
          <span className="hidden items-center gap-1 rounded-md border border-surface-200 bg-surface-50 px-2 py-1 text-[11px] font-bold text-navy-700 md:inline-flex">
            <Keyboard className="h-3.5 w-3.5" />
            Cmd K
          </span>
          <button
            type="button"
            disabled
            title={NOT_WIRED}
            className="flex h-10 w-10 items-center justify-center rounded-lg border border-surface-200 bg-white text-surface-400 disabled:cursor-not-allowed"
          >
            <Mic className="h-4 w-4" />
          </button>
          <Button type="submit" size="sm" className="hidden sm:inline-flex">
            Search
          </Button>
        </div>
      </form>
    </div>
  )
}

function SearchScopeRow({ groups, activeScope, query }: { groups: ResultGroup[]; activeScope: GroupId | "all"; query: string }) {
  const items: Array<{ id: GroupId | "all"; label: string; icon: LucideIcon; count: number; disabled?: boolean }> = [
    { id: "clients", label: "Clients", icon: Users, count: countFor(groups, "clients") },
    { id: "packets", label: "Packets", icon: FolderOpen, count: countFor(groups, "packets") },
    { id: "documents", label: "PDFs & OCR", icon: FileSearch, count: countFor(groups, "documents") },
    { id: "reports", label: "Reports", icon: BarChart3, count: 0, disabled: true },
    { id: "tasks", label: "Tasks", icon: ListChecks, count: countFor(groups, "tasks") },
    { id: "audit", label: "Audit", icon: Activity, count: countFor(groups, "audit") },
    { id: "validation", label: "Validation", icon: ShieldCheck, count: countFor(groups, "validation") },
    { id: "signatures", label: "Signatures", icon: PenSquare, count: countFor(groups, "signatures") },
    { id: "ai", label: "AI Insights", icon: BrainCircuit, count: countFor(groups, "ai") },
  ]

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-100 bg-white px-5 py-3 lg:px-7">
      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={searchHref(query, "all")}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors",
            activeScope === "all" ? "border-brand-200 bg-brand-50 text-brand-700" : "border-surface-200 bg-white text-surface-600 hover:bg-surface-50"
          )}
        >
          <Search className="h-3.5 w-3.5" />
          Search everywhere
        </Link>
        {items.map((item) => {
          const Icon = item.icon
          const active = activeScope === item.id
          const classes = cn(
            "inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors",
            active ? "border-brand-200 bg-brand-50 text-brand-700" : "border-surface-200 bg-white text-surface-600 hover:bg-surface-50",
            item.disabled && "cursor-not-allowed opacity-65"
          )
          if (item.disabled) {
            return (
              <span key={item.id} className={classes} title={NOT_WIRED}>
                <Icon className="h-3.5 w-3.5" />
                {item.label}
                <span className="rounded-full bg-surface-100 px-1.5 py-0.5 text-[10px] text-surface-500">Soon</span>
              </span>
            )
          }
          return (
            <Link key={item.id} href={searchHref(query, item.id)} className={classes}>
              <Icon className="h-3.5 w-3.5" />
              {item.label}
              <span className="rounded-full bg-surface-100 px-1.5 py-0.5 text-[10px] text-surface-500">{item.count}</span>
            </Link>
          )
        })}
      </div>
      <p className="text-[11px] font-semibold text-surface-500">Existing Higsi records only</p>
    </div>
  )
}

function SearchSidebar({ query, members, selectedResult }: { query: string; members: MemberRow[]; selectedResult: SearchResult | null }) {
  return (
    <aside className="border-b border-surface-200 bg-[#fbfdff] p-4 xl:border-b-0 xl:border-r">
      <div className="space-y-4">
        <PanelTitle icon={Zap} title="Quick Actions" />
        <div className="grid grid-cols-2 gap-2">
          <QuickAction label="Open Client" icon={Users} href={listRoute("/clients", query)} />
          <QuickAction label="Create Packet" icon={Plus} href="/packets/new" />
          <QuickAction label="Upload PDF" icon={Upload} href="/templates/new" />
          <QuickAction label="Open Editor" icon={FileCheck2} href={selectedResult?.groupId === "documents" ? selectedResult.href : undefined} disabled={selectedResult?.groupId !== "documents"} />
          <QuickAction label="Run Validation" icon={ShieldCheck} href={selectedResult?.groupId === "packets" ? selectedResult.href : undefined} disabled={selectedResult?.groupId !== "packets"} />
          <QuickAction label="Signature Workflow" icon={FileSignature} href="/signatures" />
          <QuickAction label="Generate Report" icon={BarChart3} href="/reports" />
          <QuickAction label="Create Task" icon={ClipboardList} disabled />
          <QuickAction label="Create User" icon={UserPlus} href="/settings/users" />
          <QuickAction label="Org Settings" icon={Building2} href="/settings/organization" />
          <QuickAction label="Dashboard" icon={LayoutDashboard} href="/dashboard" />
        </div>

        <div className="pt-2">
          <PanelTitle icon={Filter} title="Filters" />
          <div className="mt-3 space-y-4">
            <FilterBlock
              label="Search Type"
              options={[
                { label: "All Results", active: true },
                { label: "Exact Match", disabled: true },
                { label: "Semantic (AI)", disabled: true },
              ]}
            />
            <FilterBlock
              label="Program"
              options={["ICS", "IHS", "ICLS", "CRS", "Employment Services"].map((label) => ({ label, disabled: true }))}
            />
            <FilterBlock
              label="Packet Type"
              options={["Intake", "CSSP", "Annual Review", "Service Change"].map((label) => ({ label, disabled: true }))}
            />
            <FilterBlock
              label="Status"
              options={["All", "Draft", "In Progress", "Needs Validation", "Awaiting Signature"].map((label) => ({ label, disabled: label !== "All", active: label === "All" }))}
            />
            <FilterBlock
              label="Assigned To"
              options={(members.length ? members.slice(0, 4).map((member) => member.user.name || member.user.email) : ["No staff filters available"]).map((label) => ({ label, disabled: true }))}
            />
            <FilterBlock
              label="Due Date"
              options={["Any time", "Today", "Next 7 days", "Overdue"].map((label, index) => ({ label, active: index === 0, disabled: index !== 0 }))}
            />
            <FilterBlock
              label="Created Date"
              options={["Any time", "Last 30 days", "This quarter"].map((label, index) => ({ label, active: index === 0, disabled: index !== 0 }))}
            />
            <FilterBlock
              label="Document Type"
              options={["All documents", "PDF", "Template", "Supporting"].map((label, index) => ({ label, active: index === 0, disabled: index !== 0 }))}
            />
            <FilterBlock
              label="Priority"
              options={["All", "High", "Medium", "Low"].map((label, index) => ({ label, active: index === 0, disabled: index !== 0 }))}
            />
            <FilterBlock
              label="Tags"
              options={["No tag backend", "Coming Soon"].map((label) => ({ label, disabled: true }))}
            />
            <FilterBlock
              label="Favorites"
              options={[{ label: "Favorites filter Coming Soon", disabled: true }]}
            />
          </div>
          <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED} className="mt-4">
            <Save className="h-4 w-4" />
            Save Current Search
          </Button>
        </div>
      </div>
    </aside>
  )
}

function ResultsPanel({
  query,
  activeScope,
  groups,
  totalVisibleResults,
  selectedKey,
}: {
  query: string
  activeScope: GroupId | "all"
  groups: ResultGroup[]
  totalVisibleResults: number
  selectedKey?: string
}) {
  return (
    <section className="min-w-0 bg-white">
      <div className="border-b border-surface-200 px-4 py-4 lg:px-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-navy-950">Top Results</h2>
            <p className="text-xs font-medium text-surface-500">
              {query ? (
                <>Showing {totalVisibleResults} existing matches for <span className="font-bold text-navy-800">&quot;{truncate(query, 40)}&quot;</span></>
              ) : (
                "Recent records from searchable Higsi modules"
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="info" size="sm">{activeScope === "all" ? "All Scopes" : labelForScope(activeScope)}</Badge>
            <Button size="icon-sm" variant="ghost" disabled title={NOT_WIRED}>
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <PopularCommands query={query} />
      </div>

      <div className="max-h-none space-y-4 p-4 lg:p-5 2xl:max-h-[calc(100vh-318px)] 2xl:overflow-y-auto">
        {groups.map((group) => (
          <ResultGroupSection key={group.id} group={group} query={query} selectedKey={selectedKey} />
        ))}
      </div>
    </section>
  )
}

function PopularCommands({ query }: { query: string }) {
  const commands = [
    { label: "Open Client", icon: Users, href: listRoute("/clients", query) },
    { label: "Create Packet", icon: Plus, href: "/packets/new" },
    { label: "Upload PDF", icon: Upload, href: "/templates/new" },
    { label: "Run Validation", icon: ShieldCheck, href: "/validation" },
    { label: "Generate Report", icon: BarChart3, href: "/reports" },
    { label: "Ask Higsi AI", icon: Bot, disabled: true },
  ]

  return (
    <div className="mt-4 flex gap-2 overflow-x-auto pb-1">
      {commands.map((command) => {
        const Icon = command.icon
        const classes = "inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-surface-200 bg-white px-3 text-xs font-bold text-navy-700 shadow-sm"
        if (command.disabled) {
          return (
            <span key={command.label} className={cn(classes, "cursor-not-allowed opacity-60")} title={NOT_WIRED}>
              <Icon className="h-4 w-4" />
              {command.label}
              <Badge variant="secondary" size="sm">Soon</Badge>
            </span>
          )
        }
        return (
          <Link key={command.label} href={command.href || "/search"} className={cn(classes, "hover:bg-surface-50")}>
            <Icon className="h-4 w-4" />
            {command.label}
          </Link>
        )
      })}
    </div>
  )
}

function ResultGroupSection({ group, query, selectedKey }: { group: ResultGroup; query: string; selectedKey?: string }) {
  const Icon = group.icon
  return (
    <div className={cn("rounded-xl border border-surface-200 bg-white", group.disabled && "opacity-80")}>
      <div className="flex items-center justify-between gap-3 border-b border-surface-100 px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-100 text-navy-700">
            <Icon className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <h3 className="truncate text-sm font-bold text-navy-950">{group.label}</h3>
            <p className="text-[11px] font-medium text-surface-500">{group.count} available</p>
          </div>
        </div>
        {group.route ? (
          <Link href={group.route} className="inline-flex items-center gap-1 text-xs font-bold text-brand-700 hover:text-brand-800">
            View all
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        ) : (
          <Badge variant="secondary" size="sm">Coming Soon</Badge>
        )}
      </div>

      {group.results.length > 0 ? (
        <div className="divide-y divide-surface-100">
          {group.results.map((result) => (
            <ResultRow key={result.key} result={result} query={query} selected={selectedKey === result.key} />
          ))}
        </div>
      ) : (
        <div className="px-4 py-5">
          <EmptyStrip title={group.emptyTitle} description={group.emptyDescription} disabled={group.disabled} />
        </div>
      )}
    </div>
  )
}

function ResultRow({ result, query, selected }: { result: SearchResult; query: string; selected: boolean }) {
  const Icon = result.icon
  return (
    <div className={cn("flex gap-3 px-4 py-3 transition-colors", selected ? "bg-brand-50/60" : "hover:bg-surface-50")}>
      <Link href={selectionHref(query, result.groupId, result.key)} className="flex min-w-0 flex-1 gap-3">
        <span className={cn("mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl", toneClasses(result.tone).soft, toneClasses(result.tone).text)}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-bold text-navy-950">{result.title}</span>
            {result.status && <Badge variant={statusVariant(result.status)} size="sm" dot>{humanize(result.status)}</Badge>}
          </span>
          <span className="mt-0.5 block truncate text-xs font-medium text-surface-600">{result.subtitle}</span>
          {result.description && <span className="mt-1 block text-[11px] leading-4 text-surface-500">{truncate(result.description, 120)}</span>}
          <span className="mt-2 flex flex-wrap items-center gap-1.5">
            {result.badges.slice(0, 3).map((badge) => (
              <Badge key={badge} variant="secondary" size="sm">{badge}</Badge>
            ))}
            {typeof result.confidence === "number" && (
              <Badge variant="success" size="sm">Match {result.confidence}%</Badge>
            )}
            {result.updatedAt && <span className="text-[11px] font-semibold text-surface-400">Updated {timeAgo(result.updatedAt)}</span>}
          </span>
        </span>
      </Link>
      <div className="flex shrink-0 items-start gap-1">
        {result.actions.slice(0, 3).map((action) => {
          const ActionIcon = action.icon
          if (action.disabled || !action.href) {
            return (
              <span key={action.label} title={NOT_WIRED} className="flex h-8 w-8 cursor-not-allowed items-center justify-center rounded-md text-surface-300">
                <ActionIcon className="h-4 w-4" />
              </span>
            )
          }
          return (
            <Link key={action.label} href={action.href} title={action.label} className="flex h-8 w-8 items-center justify-center rounded-md text-surface-500 hover:bg-white hover:text-brand-700">
              <ActionIcon className="h-4 w-4" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}

function InspectorPanel({ result, selectedDocument, query }: { result: SearchResult | null; selectedDocument: SearchResult | null; query: string }) {
  const ResultIcon = result?.icon

  return (
    <aside className="border-t border-surface-200 bg-[#fbfdff] p-4 xl:border-l 2xl:border-t-0">
      <PanelTitle icon={Eye} title="Inspector" />
      {result ? (
        <div className="mt-4 space-y-4">
          <div className="rounded-xl border border-surface-200 bg-white p-4">
            <div className="flex items-start gap-3">
              <span className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-xl", toneClasses(result.tone).soft, toneClasses(result.tone).text)}>
                {ResultIcon && <ResultIcon className="h-5 w-5" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-navy-950">{result.title}</p>
                <p className="mt-1 text-xs font-medium text-surface-500">{result.subtitle}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Badge variant="outline" size="sm">{result.sourceLabel}</Badge>
                  {result.status && <Badge variant={statusVariant(result.status)} size="sm">{humanize(result.status)}</Badge>}
                </div>
              </div>
            </div>
            {result.href && (
              <Button asChild size="sm" fullWidth className="mt-4">
                <Link href={result.href}>
                  Open Record
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            )}
          </div>

          <div className="flex gap-1 overflow-x-auto rounded-xl border border-surface-200 bg-surface-50 p-1.5">
            {["Overview", "Activity", "Validation", "Signatures", "Linked", "Notes"].map((tab, index) => (
              <span
                key={tab}
                className={cn(
                  "shrink-0 rounded-lg px-3 py-1.5 text-[11px] font-bold transition-colors",
                  index === 0 ? "bg-white text-brand-700 shadow-sm" : "text-surface-500"
                )}
              >
                {tab}
              </span>
            ))}
          </div>

          <InspectorSection title="Document Details" icon={FileText}>
            <DetailList rows={result.meta.length ? result.meta : [{ label: "Record ID", value: result.id }]} />
          </InspectorSection>

          <InspectorSection title="PDF Preview" icon={FileSearch}>
            {selectedDocument ? (
              <div className="overflow-hidden rounded-xl border border-surface-200 bg-white shadow-sm">
                <div className="flex items-center gap-2 border-b border-surface-100 bg-surface-50 px-3 py-2">
                  <span className="flex h-6 w-6 items-center justify-center rounded-md bg-brand-50 text-brand-700">
                    <FileText className="h-3.5 w-3.5" />
                  </span>
                  <span className="truncate text-[11px] font-bold text-navy-900">{selectedDocument.title}</span>
                </div>
                <div className="h-36 bg-gradient-to-b from-white to-surface-50 p-4">
                  <div className="mb-2 h-2 w-28 rounded bg-surface-200" />
                  <div className="space-y-2">
                    <div className="h-2 rounded bg-surface-100" />
                    <div className="h-2 w-5/6 rounded bg-surface-100" />
                    <div className="h-2 w-4/6 rounded bg-surface-100" />
                    <div className="mt-5 h-8 rounded border border-surface-200 bg-white" />
                  </div>
                </div>
                <div className="p-3 pt-0">
                  <Button asChild size="sm" variant="secondary" fullWidth className="mt-3">
                    <Link href={selectedDocument.href || "/library"}>
                      Open PDF Editor
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </Button>
                </div>
              </div>
            ) : (
              <EmptyStrip title="No document selected" description="Select a document result to open the existing editor link." />
            )}
          </InspectorSection>

          <InspectorSection title="Packet Progress" icon={Gauge}>
            <div className="space-y-2">
              <div className="flex items-center justify-between text-xs font-bold text-navy-900">
                <span>{result.progress !== undefined ? `${result.progress}% complete` : "Progress source unavailable"}</span>
                <span className="text-surface-500">{result.groupLabel}</span>
              </div>
              <Progress value={result.progress ?? 0} />
              {result.progress === undefined && <p className="text-[11px] text-surface-500">No complete packet progress metric is exposed to this screen.</p>}
            </div>
          </InspectorSection>

          <InspectorSection title="Next Best Actions" icon={Sparkles}>
            <div className="space-y-2">
              {result.href && <MiniAction label="Open selected record" href={result.href} icon={ExternalLink} />}
              <MiniAction label="Search audit trail" href={listRoute("/audit", result.id)} icon={History} />
              <MiniAction label="Generate AI summary" icon={Bot} disabled />
              <MiniAction label="Create linked task" icon={ClipboardList} disabled />
            </div>
          </InspectorSection>

          <InspectorSection title="Timeline" icon={Clock}>
            <div className="space-y-3">
              <TimelineItem label="Record surfaced in search" date={new Date()} />
              {result.updatedAt && <TimelineItem label="Last updated" date={result.updatedAt} />}
              <TimelineItem label="Linked notes" muted text="Notes workspace Coming Soon" />
            </div>
          </InspectorSection>
        </div>
      ) : (
        <EmptyState
          className="mt-8 rounded-xl border border-dashed border-surface-200 bg-white py-10"
          title="No result selected"
          description={query ? "No matching records were found in the existing search sources." : "Search or choose a recent result to inspect it here."}
          icon={<Search className="h-7 w-7 text-surface-400" />}
        />
      )}
    </aside>
  )
}

function AiAssistantPanel({
  query,
  groups,
  recommendations,
  totalResults,
}: {
  query: string
  groups: ResultGroup[]
  recommendations: AiRecommendationRow[]
  totalResults: number
}) {
  const populatedGroups = groups.filter((group) => group.results.length > 0)
  return (
    <aside className="border-t border-surface-200 bg-[#f8fbff] p-4 2xl:border-l 2xl:border-t-0">
      <div className="flex items-center justify-between gap-3">
        <PanelTitle icon={Bot} title="Higsi AI Assistant" />
        <Badge variant="secondary" size="sm">Beta</Badge>
      </div>
      <div className="mt-4 space-y-4">
        <AssistantCard title="Today's Search Insights" icon={Sparkles}>
          <div className="grid grid-cols-3 gap-2">
            <MetricChip label="Results" value={String(totalResults)} />
            <MetricChip label="Sources" value={String(populatedGroups.length)} />
            <MetricChip label="Query" value={query ? "Active" : "Ready"} />
          </div>
          <p className="mt-3 text-[11px] leading-4 text-surface-500">Counts are derived from existing Higsi records. No AI-generated answer is produced here.</p>
        </AssistantCard>

        <AssistantCard title="Suggested Searches" icon={Search}>
          <div className="flex flex-wrap gap-2">
            {["awaiting signature", "validation failed", "annual review", "overdue packet"].map((suggestion) => (
              <Link key={suggestion} href={`/search?q=${encodeURIComponent(suggestion)}`} className="rounded-full border border-surface-200 bg-white px-2.5 py-1 text-[11px] font-bold text-navy-700 hover:bg-surface-50">
                {suggestion}
              </Link>
            ))}
          </div>
        </AssistantCard>

        <AssistantCard title="Frequently Accessed" icon={Star}>
          <EmptyStrip title="No usage history source" description="Frequently accessed items require analytics history and are Coming Soon." disabled />
        </AssistantCard>

        <AssistantCard title="AI Recommendations" icon={BrainCircuit}>
          {recommendations.length ? (
            <div className="space-y-2">
              {recommendations.slice(0, 3).map((recommendation) => (
                <div key={recommendation.id} className="rounded-lg border border-surface-200 bg-white p-3">
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant="info" size="sm">{humanize(recommendation.type)}</Badge>
                    <span className="text-[10px] font-bold text-surface-400">{timeAgo(recommendation.createdAt)}</span>
                  </div>
                  <p className="mt-2 text-xs font-semibold leading-4 text-navy-900">{truncate(recommendation.message, 110)}</p>
                </div>
              ))}
            </div>
          ) : (
            <EmptyStrip title="No open recommendations" description="Existing AI recommendation records will appear here when available." />
          )}
        </AssistantCard>

        <AssistantCard title="Ask Higsi AI" icon={MessageSquare}>
          <textarea
            disabled
            placeholder="Conversational search is Coming Soon"
            className="h-20 w-full resize-none rounded-lg border border-surface-200 bg-surface-50 p-3 text-xs font-medium text-surface-500"
          />
          <Button size="sm" fullWidth disabled title={NOT_WIRED} className="mt-2">
            Ask Higsi AI
          </Button>
        </AssistantCard>

        <div className="grid grid-cols-1 gap-3">
          <DisabledAssistantAction icon={Download} title="Executive Summary" />
          <DisabledAssistantAction icon={Radio} title="Voice Search" />
        </div>
      </div>
    </aside>
  )
}

function BottomAnalytics({ query, totalResults, workItems }: { query: string; totalResults: number; workItems: WorkItem[] }) {
  const onTime = workItems.filter((item) => item.priority === "normal").length
  const dueSoon = workItems.filter((item) => item.priority === "medium").length
  const overdue = workItems.filter((item) => item.priority === "high").length
  const slaTotal = workItems.length
  return (
    <div className="grid grid-cols-1 gap-3 border-t border-surface-200 bg-white p-4 md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-7">
      <BottomCard icon={History} title="Search History" disabled>
        <p>No saved search history backend is connected.</p>
      </BottomCard>
      <BottomCard icon={BarChart3} title="Search Analytics">
        <p>{query ? `${totalResults} current matches` : "Search to view current match counts."}</p>
      </BottomCard>
      <BottomCard icon={Gauge} title="SLA Status">
        {slaTotal > 0 ? (
          <div className="flex items-center gap-3">
            <Donut
              size={56}
              strokeWidth={9}
              segments={[
                { label: "On Time", value: onTime, className: "stroke-success-500" },
                { label: "Due Soon", value: dueSoon, className: "stroke-warning-400" },
                { label: "Overdue", value: overdue, className: "stroke-danger-500" },
              ]}
              centerLabel={<span className="text-[11px] font-bold text-navy-950">{slaTotal}</span>}
            />
            <div className="space-y-0.5 text-[10px] font-semibold">
              <p className="flex items-center gap-1.5 text-success-700"><span className="h-1.5 w-1.5 rounded-full bg-success-500" /> On Time ({onTime})</p>
              <p className="flex items-center gap-1.5 text-warning-700"><span className="h-1.5 w-1.5 rounded-full bg-warning-400" /> Due Soon ({dueSoon})</p>
              <p className="flex items-center gap-1.5 text-danger-700"><span className="h-1.5 w-1.5 rounded-full bg-danger-500" /> Overdue ({overdue})</p>
            </div>
          </div>
        ) : (
          <p>No work queue items from existing records.</p>
        )}
      </BottomCard>
      <BottomCard icon={Save} title="Saved Searches" disabled>
        <p>Saved searches are Coming Soon.</p>
      </BottomCard>
      <BottomCard icon={Keyboard} title="Keyboard Shortcuts" disabled>
        <p>Command palette shortcuts are visible but not wired.</p>
      </BottomCard>
      <BottomCard icon={Lightbulb} title="Tips">
        <p>Use exact names, MA IDs, packet types, or audit actions.</p>
      </BottomCard>
      <BottomCard icon={Mic} title="Voice Search" disabled>
        <p>Voice search is Coming Soon.</p>
      </BottomCard>
    </div>
  )
}

function QuickAction({ label, icon: Icon, href, disabled }: { label: string; icon: LucideIcon; href?: string; disabled?: boolean }) {
  const classes = "flex min-h-[68px] flex-col items-start justify-between rounded-lg border border-surface-200 bg-white p-3 text-left text-xs font-bold text-navy-800 shadow-sm"
  if (disabled || !href) {
    return (
      <span className={cn(classes, "cursor-not-allowed opacity-60")} title={NOT_WIRED}>
        <Icon className="h-4 w-4 text-surface-400" />
        <span>{label}</span>
      </span>
    )
  }
  return (
    <Link href={href} className={cn(classes, "hover:border-brand-200 hover:bg-brand-50")}>
      <Icon className="h-4 w-4 text-brand-700" />
      <span>{label}</span>
    </Link>
  )
}

function FilterBlock({ label, options }: { label: string; options: Array<{ label: string; active?: boolean; disabled?: boolean }> }) {
  return (
    <div>
      <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-surface-500">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => (
          <span
            key={option.label}
            title={option.disabled ? NOT_WIRED : undefined}
            className={cn(
              "inline-flex rounded-full border px-2.5 py-1 text-[11px] font-bold",
              option.active ? "border-brand-200 bg-brand-50 text-brand-700" : "border-surface-200 bg-white text-surface-600",
              option.disabled && "cursor-not-allowed opacity-55"
            )}
          >
            {option.label}
          </span>
        ))}
      </div>
    </div>
  )
}

function PanelTitle({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="flex h-7 w-7 items-center justify-center rounded-md bg-navy-900 text-white">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <h2 className="text-sm font-bold text-navy-950">{title}</h2>
    </div>
  )
}

function EmptyStrip({ title, description, disabled }: { title: string; description: string; disabled?: boolean }) {
  return (
    <div className={cn("rounded-lg border border-dashed border-surface-200 bg-surface-50 px-3 py-4 text-center", disabled && "opacity-80")}>
      <p className="text-xs font-bold text-navy-900">{title}</p>
      <p className="mt-1 text-[11px] leading-4 text-surface-500">{description}</p>
      {disabled && <Badge variant="secondary" size="sm" className="mt-2">Coming Soon</Badge>}
    </div>
  )
}

function InspectorSection({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-700" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-900">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function DetailList({ rows }: { rows: ResultMeta[] }) {
  return (
    <dl className="space-y-2">
      {rows.slice(0, 6).map((row) => (
        <div key={`${row.label}-${row.value}`} className="flex items-center justify-between gap-3 text-xs">
          <dt className="font-medium text-surface-500">{row.label}</dt>
          <dd className="max-w-[180px] truncate text-right font-bold text-navy-900">{row.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function MiniAction({ label, icon: Icon, href, disabled }: { label: string; icon: LucideIcon; href?: string; disabled?: boolean }) {
  const classes = "flex w-full items-center justify-between rounded-lg border border-surface-200 bg-white px-3 py-2 text-xs font-bold text-navy-800"
  if (disabled || !href) {
    return (
      <span className={cn(classes, "cursor-not-allowed opacity-55")} title={NOT_WIRED}>
        <span className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</span>
        <Lock className="h-3.5 w-3.5" />
      </span>
    )
  }
  return (
    <Link href={href} className={cn(classes, "hover:bg-surface-50")}>
      <span className="flex items-center gap-2"><Icon className="h-4 w-4" />{label}</span>
      <ArrowRight className="h-3.5 w-3.5" />
    </Link>
  )
}

function TimelineItem({ label, date, text, muted }: { label: string; date?: Date | string | null; text?: string; muted?: boolean }) {
  return (
    <div className="flex gap-2">
      <Circle className={cn("mt-0.5 h-3 w-3 shrink-0", muted ? "fill-surface-200 text-surface-200" : "fill-brand-600 text-brand-600")} />
      <div>
        <p className="text-xs font-bold text-navy-900">{label}</p>
        <p className="text-[11px] font-medium text-surface-500">{date ? formatDate(date) : text}</p>
      </div>
    </div>
  )
}

function AssistantCard({ title, icon: Icon, children }: { title: string; icon: LucideIcon; children: ReactNode }) {
  return (
    <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-700" />
        <h3 className="text-xs font-bold uppercase tracking-wide text-navy-900">{title}</h3>
      </div>
      {children}
    </section>
  )
}

function MetricChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-50 p-2 text-center">
      <p className="text-base font-bold text-navy-950">{value}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-surface-500">{label}</p>
    </div>
  )
}

function DisabledAssistantAction({ icon: Icon, title }: { icon: LucideIcon; title: string }) {
  return (
    <div title={NOT_WIRED} className="flex items-center justify-between rounded-xl border border-dashed border-surface-300 bg-white p-3 opacity-65">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-surface-400" />
        <span className="text-xs font-bold text-navy-900">{title}</span>
      </div>
      <Badge variant="secondary" size="sm">Coming Soon</Badge>
    </div>
  )
}

function BottomCard({ icon: Icon, title, children, disabled }: { icon: LucideIcon; title: string; children: ReactNode; disabled?: boolean }) {
  return (
    <div className={cn("min-h-[112px] rounded-xl border border-surface-200 bg-[#fbfdff] p-3", disabled && "opacity-65")}>
      <div className="flex items-center justify-between gap-2">
        <Icon className="h-4 w-4 text-brand-700" />
        {disabled && <Badge variant="secondary" size="sm">Coming Soon</Badge>}
      </div>
      <p className="mt-3 text-xs font-bold text-navy-950">{title}</p>
      <div className="mt-1 text-[11px] leading-4 text-surface-500">{children}</div>
    </div>
  )
}

function clientToResult(client: ClientRow, query: string): SearchResult {
  const name = `${client.firstName} ${client.lastName}`
  const programs = client.enrollments.map((enrollment) => enrollment.program.code || enrollment.program.name).slice(0, 2)
  return {
    key: `clients:${client.id}`,
    id: client.id,
    groupId: "clients",
    groupLabel: "Clients",
    icon: Users,
    tone: "brand",
    title: name,
    subtitle: [client.mcadId ? `MA ID ${client.mcadId}` : null, client.email].filter(Boolean).join(" - ") || "Client record",
    href: `/clients/${client.id}`,
    status: client.status,
    badges: programs.length ? programs : ["Client"],
    updatedAt: client.updatedAt,
    confidence: matchConfidence([name, client.email, client.mcadId].filter(Boolean).join(" "), query),
    meta: [
      { label: "Status", value: humanize(client.status) },
      { label: "MA ID", value: client.mcadId || "Not recorded" },
      { label: "Programs", value: programs.join(", ") || "None" },
      { label: "Packets", value: String(client._count.packets) },
      { label: "Updated", value: formatDate(client.updatedAt) },
    ],
    actions: [
      { label: "Open Client", href: `/clients/${client.id}`, icon: ExternalLink },
      { label: "Edit", href: `/clients/${client.id}/edit`, icon: PenSquare },
      { label: "Audit", href: listRoute("/audit", client.id), icon: History },
    ],
    sourceLabel: "Client",
  }
}

function packetToResult(packet: PacketRow, query: string): SearchResult {
  const clientName = `${packet.client.firstName} ${packet.client.lastName}`
  const title = `${humanize(packet.packetType)} Packet`
  return {
    key: `packets:${packet.id}`,
    id: packet.id,
    groupId: "packets",
    groupLabel: "Packets",
    icon: FolderOpen,
    tone: packetTone(packet.status),
    title,
    subtitle: `${clientName} - ${packet._count.documents} document${packet._count.documents === 1 ? "" : "s"}`,
    href: `/packets/${packet.id}`,
    status: packet.status,
    badges: [humanize(packet.packetType), packet.assignedTo?.name ? `Assigned to ${packet.assignedTo.name}` : "Unassigned"],
    updatedAt: packet.updatedAt,
    confidence: matchConfidence([title, clientName, packet.packetType, packet.status].join(" "), query),
    meta: [
      { label: "Client", value: clientName },
      { label: "Packet Type", value: humanize(packet.packetType) },
      { label: "Status", value: humanize(packet.status) },
      { label: "Due Date", value: formatDate(packet.dueDate) },
      { label: "Assigned To", value: packet.assignedTo?.name || "Unassigned" },
      { label: "Documents", value: String(packet._count.documents) },
    ],
    actions: [
      { label: "Open Packet", href: `/packets/${packet.id}`, icon: ExternalLink },
      { label: "Validate", href: `/packets/${packet.id}`, icon: ShieldCheck },
      { label: "Audit", href: listRoute("/audit", packet.id), icon: History },
    ],
    progress: progressFromStatus(packet.status),
    sourceLabel: "Packet",
  }
}

function buildDocumentResults(rows: LibraryRows, query: string): SearchResult[] {
  const packetDocs = rows.packetDocs.map((doc) => packetDocumentToResult(doc, query))
  const templates = rows.templates.map((doc) => templateDocumentToResult(doc, query))
  const supporting = rows.supportingDocs.map((doc) => supportingDocumentToResult(doc, query))
  return [...packetDocs, ...templates, ...supporting]
    .filter((result) => matchesQuery([result.title, result.subtitle, result.description, result.status, result.badges.join(" ")].filter(Boolean).join(" "), query))
    .sort((a, b) => dateValue(b.updatedAt) - dateValue(a.updatedAt))
}

function packetDocumentToResult(doc: PacketDocumentRow, query: string): SearchResult {
  const title = doc.documentTemplate.name
  const clientName = `${doc.packet.client.firstName} ${doc.packet.client.lastName}`
  return {
    key: `documents:${doc.id}`,
    id: doc.id,
    groupId: "documents",
    groupLabel: "Documents",
    icon: FileText,
    tone: "info",
    title,
    subtitle: `${clientName} - ${humanize(doc.packet.packetType)} packet`,
    href: `/documents/${doc.id}/edit`,
    status: doc.status,
    badges: [doc.documentTemplate.formType || "PDF", `v${doc.documentTemplate.version}`, humanize(doc.packet.status)],
    updatedAt: doc.updatedAt,
    confidence: matchConfidence([title, clientName, doc.documentTemplate.formType, doc.packet.packetType].filter(Boolean).join(" "), query),
    meta: [
      { label: "Document Type", value: doc.documentTemplate.formType || "PDF" },
      { label: "Client", value: clientName },
      { label: "Packet", value: humanize(doc.packet.packetType) },
      { label: "Packet Status", value: humanize(doc.packet.status) },
      { label: "Required", value: doc.isRequired ? "Yes" : "No" },
      { label: "Updated", value: formatDate(doc.updatedAt) },
    ],
    actions: [
      { label: "Open Editor", href: `/documents/${doc.id}/edit`, icon: FileCheck2 },
      { label: "Packet", href: `/packets/${doc.packet.id}`, icon: FolderOpen },
      { label: "Audit", href: listRoute("/audit", doc.id), icon: History },
    ],
    progress: progressFromStatus(doc.status),
    sourceLabel: "Packet Document",
  }
}

function templateDocumentToResult(doc: TemplateDocumentRow, query: string): SearchResult {
  return {
    key: `documents:${doc.id}`,
    id: doc.id,
    groupId: "documents",
    groupLabel: "Documents",
    icon: FileSearch,
    tone: "purple",
    title: doc.name,
    subtitle: doc.description || "Reusable document template",
    href: "/templates",
    status: doc.status,
    badges: [doc.formType || "Template", doc.program || "All programs", `v${doc.version}`],
    updatedAt: doc.updatedAt,
    confidence: matchConfidence([doc.name, doc.description, doc.formType, doc.program].filter(Boolean).join(" "), query),
    meta: [
      { label: "Form Type", value: doc.formType || "Template" },
      { label: "Program", value: doc.program || "All programs" },
      { label: "Status", value: humanize(doc.status) },
      { label: "Version", value: String(doc.version) },
      { label: "Uploaded By", value: doc.uploadedBy?.name || "Unknown" },
      { label: "Updated", value: formatDate(doc.updatedAt) },
    ],
    actions: [
      { label: "Templates", href: "/templates", icon: ExternalLink },
      { label: "Upload", href: "/templates/new", icon: Upload },
      { label: "Audit", href: listRoute("/audit", doc.id), icon: History },
    ],
    sourceLabel: "Template",
  }
}

function supportingDocumentToResult(doc: SupportingDocumentRow, query: string): SearchResult {
  const clientName = doc.client ? `${doc.client.firstName} ${doc.client.lastName}` : "Organization document"
  return {
    key: `documents:${doc.id}`,
    id: doc.id,
    groupId: "documents",
    groupLabel: "Documents",
    icon: FileText,
    tone: "slate",
    title: doc.title,
    subtitle: `${humanize(doc.category)} - ${clientName}`,
    description: doc.description || undefined,
    href: "/library",
    status: "supporting",
    badges: [humanize(doc.category), doc.mimeType || "File"],
    updatedAt: doc.updatedAt ?? doc.createdAt,
    confidence: matchConfidence([doc.title, doc.description, doc.category, clientName].filter(Boolean).join(" "), query),
    meta: [
      { label: "Category", value: humanize(doc.category) },
      { label: "Client", value: clientName },
      { label: "Mime Type", value: doc.mimeType || "File" },
      { label: "Uploaded By", value: doc.uploadedBy?.name || "Unknown" },
      { label: "Created", value: formatDate(doc.createdAt) },
    ],
    actions: [
      { label: "Library", href: "/library", icon: ExternalLink },
      { label: "Audit", href: listRoute("/audit", doc.id), icon: History },
      { label: "Preview", disabled: true, icon: Eye },
    ],
    sourceLabel: "Supporting Document",
  }
}

function validationToResult(row: ValidationRow, query: string): SearchResult {
  const clientName = row.packet ? `${row.packet.client.firstName} ${row.packet.client.lastName}` : "Packet"
  const title = row.criticalCount > 0
    ? `${row.criticalCount} critical validation issue${row.criticalCount === 1 ? "" : "s"}`
    : row.warningCount > 0
      ? `${row.warningCount} validation warning${row.warningCount === 1 ? "" : "s"}`
      : "Validation passed"
  return {
    key: `validation:${row.id}`,
    id: row.id,
    groupId: "validation",
    groupLabel: "Validation Issues",
    icon: row.criticalCount > 0 ? AlertTriangle : CheckCircle2,
    tone: row.criticalCount > 0 ? "danger" : row.warningCount > 0 ? "warning" : "success",
    title,
    subtitle: `${clientName} - ${row.packet ? humanize(row.packet.packetType) : "Packet"} - Score ${row.score}%`,
    href: `/validation/${row.id}`,
    status: row.criticalCount > 0 ? "failed" : "passed",
    badges: [`${row.totalIssues} issues`, `${row.warningCount} warnings`, `Score ${row.score}%`],
    updatedAt: row.ranAt,
    confidence: matchConfidence(validationSearchText(row), query),
    meta: [
      { label: "Client", value: clientName },
      { label: "Score", value: `${row.score}%` },
      { label: "Critical", value: String(row.criticalCount) },
      { label: "Warnings", value: String(row.warningCount) },
      { label: "Ran By", value: row.ranBy?.name || "System" },
      { label: "Ran", value: formatDate(row.ranAt) },
    ],
    actions: [
      { label: "Open Validation", href: `/validation/${row.id}`, icon: ExternalLink },
      { label: "Packet", href: row.packetId ? `/packets/${row.packetId}` : undefined, icon: FolderOpen, disabled: !row.packetId },
      { label: "Audit", href: listRoute("/audit", row.id), icon: History },
    ],
    progress: row.score,
    sourceLabel: "Validation",
  }
}

function workItemToResult(item: WorkItem, query: string): SearchResult {
  return {
    key: `tasks:${item.id}`,
    id: item.id,
    groupId: "tasks",
    groupLabel: "Tasks",
    icon: ListChecks,
    tone: item.priority === "high" ? "danger" : item.priority === "medium" ? "warning" : "brand",
    title: item.title,
    subtitle: [item.clientName, item.packetType ? humanize(item.packetType) : null, item.assignedToName ? `Assigned to ${item.assignedToName}` : null].filter(Boolean).join(" - ") || "Work queue item",
    href: item.href,
    status: item.status,
    badges: [humanize(item.source), humanize(item.priority), item.dueDate ? `Due ${formatDate(item.dueDate)}` : "No due date"],
    updatedAt: item.lastUpdated,
    confidence: matchConfidence(workItemSearchText(item), query),
    meta: [
      { label: "Source", value: humanize(item.source) },
      { label: "Priority", value: humanize(item.priority) },
      { label: "Client", value: item.clientName || "None" },
      { label: "Packet", value: item.packetType ? humanize(item.packetType) : "None" },
      { label: "Assigned To", value: item.assignedToName || "Unassigned" },
      { label: "Due Date", value: formatDate(item.dueDate) },
    ],
    actions: [
      { label: "Open Work", href: item.href, icon: ExternalLink },
      { label: "Task Queue", href: "/tasks", icon: ListChecks },
      { label: "Audit", href: item.packetId ? listRoute("/audit", item.packetId) : undefined, icon: History, disabled: !item.packetId },
    ],
    sourceLabel: "Work Queue",
  }
}

function auditToResult(event: AuditRow, query: string): SearchResult {
  const title = humanize(event.action)
  return {
    key: `audit:${event.id}`,
    id: event.id,
    groupId: "audit",
    groupLabel: "Audit Events",
    icon: Activity,
    tone: "navy",
    title,
    subtitle: [event.targetType ? humanize(event.targetType) : "Audit event", event.actor?.name || event.actor?.email || "System"].join(" - "),
    href: `/audit/${event.id}`,
    status: event.action,
    badges: [event.targetType ? humanize(event.targetType) : "Event", event.organization?.name || "Organization"],
    updatedAt: event.createdAt,
    confidence: matchConfidence([event.action, event.targetType, event.targetId].filter(Boolean).join(" "), query),
    meta: [
      { label: "Action", value: title },
      { label: "Target Type", value: event.targetType ? humanize(event.targetType) : "Unknown" },
      { label: "Target ID", value: event.targetId || "None" },
      { label: "Actor", value: event.actor?.name || event.actor?.email || "System" },
      { label: "Created", value: formatDate(event.createdAt) },
    ],
    actions: [
      { label: "Open Event", href: `/audit/${event.id}`, icon: ExternalLink },
      { label: "Search Target", href: event.targetId ? listRoute("/audit", event.targetId) : undefined, icon: Search, disabled: !event.targetId },
      { label: "Export", disabled: true, icon: Download },
    ],
    sourceLabel: "Audit",
  }
}

function signatureToResult(row: SignatureRow, query: string): SearchResult {
  const clientName = row.packet ? `${row.packet.client.firstName} ${row.packet.client.lastName}` : "Packet not linked"
  return {
    key: `signatures:${row.id}`,
    id: row.id,
    groupId: "signatures",
    groupLabel: "Signatures",
    icon: FileSignature,
    tone: row.status === "signed" ? "success" : "warning",
    title: `Signature request - ${row.signerName}`,
    subtitle: `${clientName} - ${row.signerEmail}`,
    href: `/signatures/${row.id}`,
    status: row.status,
    badges: [row.signerRole || row.signerType || "Signer", row.dueDate ? `Due ${formatDate(row.dueDate)}` : "No due date"],
    updatedAt: row.updatedAt,
    confidence: matchConfidence(signatureSearchText(row), query),
    meta: [
      { label: "Signer", value: row.signerName },
      { label: "Email", value: row.signerEmail },
      { label: "Status", value: humanize(row.status) },
      { label: "Client", value: clientName },
      { label: "Requested By", value: row.requestedBy?.name || "Unknown" },
      { label: "Due", value: formatDate(row.dueDate) },
    ],
    actions: [
      { label: "Open Signature", href: `/signatures/${row.id}`, icon: ExternalLink },
      { label: "Packet", href: row.packetId ? `/packets/${row.packetId}` : undefined, icon: FolderOpen, disabled: !row.packetId },
      { label: "Audit", href: listRoute("/audit", row.id), icon: History },
    ],
    sourceLabel: "Signature",
  }
}

function aiToResult(row: AiRecommendationRow, query: string): SearchResult {
  const packetClient = row.packet?.client ? `${row.packet.client.firstName} ${row.packet.client.lastName}` : "Organization insight"
  const docName = row.packetDocument?.documentTemplate?.name
  return {
    key: `ai:${row.id}`,
    id: row.id,
    groupId: "ai",
    groupLabel: "AI Insights",
    icon: BrainCircuit,
    tone: "purple",
    title: humanize(row.type),
    subtitle: docName ? `${docName} - ${packetClient}` : packetClient,
    description: row.message,
    href: "/ai-copilot",
    status: row.status,
    badges: [humanize(row.type), "Existing recommendation"],
    updatedAt: row.createdAt,
    confidence: matchConfidence(aiSearchText(row), query),
    meta: [
      { label: "Type", value: humanize(row.type) },
      { label: "Status", value: humanize(row.status) },
      { label: "Client", value: packetClient },
      { label: "Document", value: docName || "None" },
      { label: "Created", value: formatDate(row.createdAt) },
    ],
    actions: [
      { label: "Open AI Copilot", href: "/ai-copilot", icon: ExternalLink },
      { label: "Apply", disabled: true, icon: CheckCircle2 },
      { label: "Dismiss", disabled: true, icon: X },
    ],
    sourceLabel: "AI Recommendation",
  }
}

function normalizeParam(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return value[0] ?? ""
  return value ?? ""
}

function matchesQuery(text: string, query: string): boolean {
  if (!query) return true
  return text.toLowerCase().includes(query.toLowerCase())
}

function matchConfidence(text: string, query: string): number | undefined {
  if (!query) return undefined
  const haystack = text.toLowerCase()
  const needle = query.toLowerCase()
  if (!haystack.includes(needle)) return 72
  if (haystack === needle) return 99
  if (haystack.startsWith(needle)) return 96
  return 91
}

function validationSearchText(row: ValidationRow): string {
  const clientName = row.packet ? `${row.packet.client.firstName} ${row.packet.client.lastName}` : ""
  return [clientName, row.packet?.packetType, row.packet?.status, row.score, row.totalIssues, row.criticalCount, row.warningCount].filter(Boolean).join(" ")
}

function workItemSearchText(item: WorkItem): string {
  return [item.title, item.clientName, item.packetType, item.assignedToName, item.status, item.source, item.priority].filter(Boolean).join(" ")
}

function signatureSearchText(row: SignatureRow): string {
  const clientName = row.packet ? `${row.packet.client.firstName} ${row.packet.client.lastName}` : ""
  return [row.signerName, row.signerEmail, row.signerRole, row.signerType, row.status, clientName, row.packet?.packetType].filter(Boolean).join(" ")
}

function aiSearchText(row: AiRecommendationRow): string {
  const clientName = row.packet?.client ? `${row.packet.client.firstName} ${row.packet.client.lastName}` : ""
  return [row.type, row.status, row.message, clientName, row.packetDocument?.documentTemplate?.name].filter(Boolean).join(" ")
}

function listRoute(route: string, query: string): string {
  if (!query) return route
  return `${route}?search=${encodeURIComponent(query)}`
}

function searchHref(query: string, scope: GroupId | "all"): string {
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  if (scope !== "all") params.set("scope", scope)
  const qs = params.toString()
  return `/search${qs ? `?${qs}` : ""}`
}

function selectionHref(query: string, scope: GroupId, selected: string): string {
  const params = new URLSearchParams()
  if (query) params.set("q", query)
  params.set("scope", scope)
  params.set("selected", selected)
  return `/search?${params.toString()}`
}

function countFor(groups: ResultGroup[], id: GroupId): number {
  return groups.find((group) => group.id === id)?.count ?? 0
}

function labelForScope(scope: GroupId | "all"): string {
  const labels: Record<GroupId | "all", string> = {
    all: "All Scopes",
    clients: "Clients",
    packets: "Packets",
    documents: "PDFs & OCR",
    reports: "Reports",
    tasks: "Tasks",
    audit: "Audit",
    validation: "Validation",
    signatures: "Signatures",
    ai: "AI Insights",
  }
  return labels[scope]
}

function humanize(value: string | null | undefined): string {
  if (!value) return "None"
  return value
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase())
}

function dateValue(date: Date | string | null | undefined): number {
  if (!date) return 0
  return new Date(date).getTime()
}

function progressFromStatus(status: string): number | undefined {
  const normalized = status.toLowerCase()
  if (["approved", "archived", "completed", "signed", "passed"].includes(normalized)) return 100
  if (["awaiting_signature", "needs_approval"].includes(normalized)) return 82
  if (["needs_validation", "in_progress"].includes(normalized)) return 62
  if (["validation_failed"].includes(normalized)) return 46
  if (["draft", "pending"].includes(normalized)) return 24
  return undefined
}

function packetTone(status: string): Tone {
  if (["approved", "archived", "completed"].includes(status)) return "success"
  if (["validation_failed", "overdue"].includes(status)) return "danger"
  if (["awaiting_signature", "needs_validation", "pending"].includes(status)) return "warning"
  return "brand"
}

function statusVariant(status: string): "default" | "secondary" | "success" | "warning" | "danger" | "info" | "outline" {
  const normalized = status.toLowerCase()
  if (["approved", "archived", "completed", "signed", "passed", "active"].includes(normalized)) return "success"
  if (["validation_failed", "failed", "critical", "declined", "rejected"].includes(normalized)) return "danger"
  if (["pending", "draft", "needs_validation", "awaiting_signature", "warning", "sent", "viewed"].includes(normalized)) return "warning"
  if (["supporting"].includes(normalized)) return "info"
  return "secondary"
}

function toneClasses(tone: Tone): { soft: string; text: string } {
  switch (tone) {
    case "brand":
      return { soft: "bg-brand-50", text: "text-brand-700" }
    case "success":
      return { soft: "bg-success-50", text: "text-success-700" }
    case "warning":
      return { soft: "bg-warning-50", text: "text-warning-700" }
    case "danger":
      return { soft: "bg-danger-50", text: "text-danger-700" }
    case "info":
      return { soft: "bg-sky-50", text: "text-sky-700" }
    case "purple":
      return { soft: "bg-violet-50", text: "text-violet-700" }
    case "navy":
      return { soft: "bg-navy-50", text: "text-navy-700" }
    default:
      return { soft: "bg-surface-100", text: "text-surface-600" }
  }
}
