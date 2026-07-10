import Link from "next/link"
import type React from "react"
import { UserRole } from "@prisma/client"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { SearchInput } from "@/components/ui/search-input"
import { Select } from "@/components/ui/select"
import {
  Archive,
  ArrowRight,
  CheckCircle2,
  Clock3,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Filter,
  FolderOpen,
  Layers,
  Library,
  MoreHorizontal,
  Plus,
  ScrollText,
  ShieldCheck,
  Upload,
} from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"
import { signUrl } from "@/lib/storage"
import { getDocumentTemplates, getPacketTemplates, getProgramsForOrg, getTemplateActivity } from "@/lib/actions/templates"

interface Props {
  orgId: string
  role: UserRole
  isSuperAdmin: boolean
  search?: string
  status?: string
  programFilter?: string
  packetType?: string
  formType?: string
}

type DocumentTemplate = {
  id: string
  name: string
  description: string | null
  formType: string
  program: string | null
  status: string
  version: number
  fileSize: number | null
  fileKey: string
  uploadedBy: { name: string | null; email: string | null } | null
  updatedAt: Date
  _count: { packetTemplateDocs: number; packetDocuments: number }
  packetTypes: unknown
}
type PacketTemplate = {
  id: string
  name: string
  description: string | null
  packetType: string
  programId: string | null
  program: { id: string; name: string; code: string } | null
  status: string
  isDefault: boolean
  requiredDocs: Array<{
    id: string
    required: boolean
    sortOrder: number
    documentTemplate: { id: string; name: string }
  }>
}
type Program = { id: string; name: string; code: string }
type TemplateActivity = {
  id: string
  action: string
  targetType: string | null
  metadata: unknown
  actor: { name: string | null; email: string | null } | null
  createdAt: Date
}

const MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "draft", label: "Draft" },
  { value: "retired", label: "Retired" },
]

const FORM_TYPE_OPTIONS = [
  { value: "dhs", label: "DHS official" },
  { value: "medical", label: "Medical" },
  { value: "progress", label: "Progress note" },
  { value: "incident", label: "Incident report" },
  { value: "consent", label: "Consent" },
  { value: "assessment", label: "Assessment" },
  { value: "other", label: "Other" },
]

const PACKET_TYPE_OPTIONS = [
  { value: "initial_intake", label: "Initial Intake" },
  { value: "annual_review", label: "Annual Review" },
  { value: "semiannual_review", label: "Semiannual Review" },
  { value: "45_day", label: "45-Day Review" },
  { value: "change_of_status", label: "Change of Status" },
]

function canManageTemplates(role: UserRole, isSuperAdmin: boolean) {
  return isSuperAdmin || MANAGE_ROLES.includes(role)
}

function packetTypeLabel(type: string) {
  return type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formTypeLabel(type: string | null | undefined) {
  if (!type) return "Other"
  return FORM_TYPE_OPTIONS.find((option) => option.value === type)?.label ?? packetTypeLabel(type)
}

function formatFileSize(bytes: number | null | undefined) {
  if (!bytes) return "Size unavailable"
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function parsePacketTypes(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string")
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value)
      return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []
    } catch {
      return []
    }
  }
  return []
}

function programLabel(programValue: string | null | undefined, programs: Program[]) {
  if (!programValue) return "All programs"
  const program = programs.find((item) => item.id === programValue || item.code === programValue || item.name === programValue)
  return program?.code || program?.name || programValue
}

function docMatchesProgram(template: DocumentTemplate, selectedProgram: Program | undefined, programFilter: string | undefined) {
  if (!programFilter || programFilter === "all") return true
  if (!selectedProgram) return template.program === programFilter
  return template.program === selectedProgram.id || template.program === selectedProgram.code || template.program === selectedProgram.name
}

function activityLabel(event: TemplateActivity) {
  const metadata = typeof event.metadata === "object" && event.metadata && !Array.isArray(event.metadata)
    ? event.metadata as Record<string, unknown>
    : {}
  const targetName = typeof metadata.name === "string" ? metadata.name : event.targetType?.replace(/_/g, " ") ?? "template"
  const action = event.action.replace(/_/g, " ").toLowerCase()
  return `${targetName} - ${action}`
}

function templatesHref(current: Record<string, string | undefined>, overrides: Record<string, string | undefined> = {}, reset = false) {
  const params = new URLSearchParams()
  const next = reset ? overrides : { ...current, ...overrides }
  for (const [key, value] of Object.entries(next)) {
    if (value && value !== "all") params.set(key, value)
  }
  const query = params.toString()
  return query ? `/templates?${query}` : "/templates"
}

export async function TemplatesListContent({
  orgId,
  role,
  isSuperAdmin,
  search,
  status,
  programFilter,
  packetType,
  formType,
}: Props) {
  let docTemplates: Awaited<ReturnType<typeof getDocumentTemplates>>
  let packetTemplates: Awaited<ReturnType<typeof getPacketTemplates>>
  let programs: Awaited<ReturnType<typeof getProgramsForOrg>>
  let recentActivity: Awaited<ReturnType<typeof getTemplateActivity>>

  try {
    [docTemplates, packetTemplates, programs, recentActivity] = await Promise.all([
      getDocumentTemplates(orgId),
      getPacketTemplates(orgId, { includeInactive: true }),
      getProgramsForOrg(orgId),
      getTemplateActivity(orgId, 8),
    ])
  } catch (e) {
    return <ErrorState title="Error loading templates" description={(e as Error).message} />
  }

  const canManage = canManageTemplates(role, isSuperAdmin)
  const selectedProgram = programs.find((program) => program.id === programFilter)
  const currentFilters = { search, status, program: programFilter, packetType, formType }
  const normalizedSearch = search?.trim().toLowerCase()

  const docPacketTypes = new Map<string, Set<string>>()
  for (const packetTemplate of packetTemplates) {
    for (const row of packetTemplate.requiredDocs) {
      const current = docPacketTypes.get(row.documentTemplate.id) ?? new Set<string>()
      current.add(packetTemplate.packetType)
      docPacketTypes.set(row.documentTemplate.id, current)
    }
  }

  const getDocPacketTypes = (template: DocumentTemplate) => {
    const mapped = Array.from(docPacketTypes.get(template.id) ?? [])
    const declared = parsePacketTypes(template.packetTypes)
    return Array.from(new Set([...mapped, ...declared]))
  }

  const filteredDocTemplates = docTemplates.filter((template) => {
    const mappedPacketTypes = getDocPacketTypes(template)
    const programMatches = docMatchesProgram(template, selectedProgram, programFilter)
    const statusMatches = !status || status === "all" || template.status === status
    const typeMatches = !formType || formType === "all" || template.formType === formType
    const packetMatches = !packetType || packetType === "all" || mappedPacketTypes.includes(packetType)
    const searchMatches = !normalizedSearch ||
      template.name.toLowerCase().includes(normalizedSearch) ||
      template.description?.toLowerCase().includes(normalizedSearch) ||
      template.formType.toLowerCase().includes(normalizedSearch) ||
      (template.program ?? "").toLowerCase().includes(normalizedSearch)
    return programMatches && statusMatches && typeMatches && packetMatches && Boolean(searchMatches)
  })

  const filteredPacketTemplates = packetTemplates.filter((template) => {
    const programMatches = !programFilter || programFilter === "all" || template.programId === programFilter
    const statusMatches = !status || status === "all" || template.status === status
    const packetMatches = !packetType || packetType === "all" || template.packetType === packetType
    const searchMatches = !normalizedSearch ||
      template.name.toLowerCase().includes(normalizedSearch) ||
      template.description?.toLowerCase().includes(normalizedSearch) ||
      template.packetType.toLowerCase().includes(normalizedSearch) ||
      template.program?.name.toLowerCase().includes(normalizedSearch) ||
      template.program?.code.toLowerCase().includes(normalizedSearch)
    return programMatches && statusMatches && packetMatches && Boolean(searchMatches)
  })

  const combinedTemplates = [
    ...docTemplates.map((template) => ({ status: template.status, type: "document" as const })),
    ...packetTemplates.map((template) => ({ status: template.status, type: "packet" as const })),
  ]
  const countStatus = (target: string) => combinedTemplates.filter((template) => template.status === target).length
  const activeCount = countStatus("active")
  const draftCount = countStatus("draft")
  const retiredCount = countStatus("retired")
  const dhsCount = docTemplates.filter((template) => template.formType === "dhs").length
  const mappingCount = packetTemplates.reduce((sum, template) => sum + template.requiredDocs.length, 0)
  const requiredCount = packetTemplates.reduce((sum, template) => sum + template.requiredDocs.filter((doc) => doc.required).length, 0)
  const optionalCount = mappingCount - requiredCount

  const formTypeCounts = FORM_TYPE_OPTIONS.map((option) => ({
    ...option,
    count: docTemplates.filter((template) => template.formType === option.value).length,
  })).filter((option) => option.count > 0 || ["dhs", "medical", "incident"].includes(option.value))

  const packetTypeCounts = PACKET_TYPE_OPTIONS.map((option) => ({
    ...option,
    count: packetTemplates.filter((template) => template.packetType === option.value).length,
  })).filter((option) => option.count > 0 || ["initial_intake", "annual_review", "semiannual_review", "45_day"].includes(option.value))

  const selectedTemplate = filteredDocTemplates[0] ?? docTemplates[0] ?? null
  const selectedTemplatePacketTypes = selectedTemplate ? getDocPacketTypes(selectedTemplate) : []
  const selectedTemplatePacketTemplates = selectedTemplate
    ? packetTemplates.filter((template) => template.requiredDocs.some((doc) => doc.documentTemplate.id === selectedTemplate.id))
    : []

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Templates & Forms Manager</h1>
          <p className="mt-1 text-sm text-surface-500">
            Manage official DHS forms, organization templates, packet definitions, and required document mappings.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/library?tab=templates">
            <Button variant="secondary" size="sm"><Library className="h-4 w-4" /> Document Library</Button>
          </Link>
          <Link href="/packets/new">
            <Button variant="secondary" size="sm"><FolderOpen className="h-4 w-4" /> Create Packet</Button>
          </Link>
          {canManage && (
            <>
              <Link href="/templates/new?tab=packet">
                <Button variant="secondary" size="sm"><Plus className="h-4 w-4" /> Create Packet Template</Button>
              </Link>
              <Link href="/templates/new">
                <Button size="sm"><Upload className="h-4 w-4" /> Upload PDF</Button>
              </Link>
            </>
          )}
        </div>
      </div>

      {/* Summary Stats */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        <SummaryCard label="Active Templates" value={activeCount} sub={`${docTemplates.filter((t) => t.status === "active").length} forms, ${packetTemplates.filter((t) => t.status === "active").length} packets`} icon={CheckCircle2} tone="success" />
        <SummaryCard label="Draft Templates" value={draftCount} sub="Waiting for activation" icon={Clock3} tone="brand" />
        <SummaryCard label="Retired Templates" value={retiredCount} sub="Excluded from new work" icon={Archive} tone="warning" />
        <SummaryCard label="DHS Official Forms" value={dhsCount} sub="Document templates" icon={FileCheck2} tone="info" />
        <SummaryCard label="Packet Templates" value={packetTemplates.length} sub="Reusable definitions" icon={Layers} tone="violet" />
        <SummaryCard label="Doc Mappings" value={mappingCount} sub={`${requiredCount} required, ${optionalCount} optional`} icon={ShieldCheck} tone="surface" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[260px_minmax(0,1fr)_300px]">
        {/* Left Sidebar - Filters */}
        <aside className="space-y-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Template Categories</CardTitle>
              <CardDescription>Filter templates by type and status</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 p-3 pt-0">
              <CategoryLink
                label="All Templates"
                count={docTemplates.length + packetTemplates.length}
                href={templatesHref(currentFilters, {}, true)}
                active={!search && !status && !programFilter && !packetType && !formType}
              />
              {formTypeCounts.map((item) => (
                <CategoryLink
                  key={item.value}
                  label={item.label}
                  count={item.count}
                  href={templatesHref(currentFilters, { formType: item.value }, true)}
                  active={formType === item.value}
                />
              ))}
              <CategoryLink
                label="Archived"
                count={retiredCount}
                href={templatesHref(currentFilters, { status: "retired" }, true)}
                active={status === "retired"}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Packet Types</CardTitle>
              <CardDescription>Filter packet definitions and mapped forms</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 p-3 pt-0">
              {packetTypeCounts.map((item) => (
                <CategoryLink
                  key={item.value}
                  label={item.label}
                  count={item.count}
                  href={templatesHref(currentFilters, { packetType: item.value }, true)}
                  active={packetType === item.value}
                />
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Programs</CardTitle>
              <CardDescription>Program assignment filters</CardDescription>
            </CardHeader>
            <CardContent className="space-y-1 p-3 pt-0">
              {programs.map((program) => {
                const count = docTemplates.filter((template) => docMatchesProgram(template, program, program.id)).length +
                  packetTemplates.filter((template) => template.programId === program.id).length
                return (
                  <CategoryLink
                    key={program.id}
                    label={program.code || program.name}
                    count={count}
                    href={templatesHref(currentFilters, { program: program.id }, true)}
                    active={programFilter === program.id}
                  />
                )
              })}
            </CardContent>
          </Card>
        </aside>

        {/* Main Content */}
        <main className="min-w-0 space-y-6">
          {/* Filter Bar */}
          <Card>
            <CardContent className="p-4">
              <form className="grid gap-3 lg:grid-cols-[minmax(220px,1fr)_160px_160px_170px_150px_auto] lg:items-end">
                <SearchInput name="search" defaultValue={search} placeholder="Search templates, DHS forms, programs..." />
                <Select
                  name="program"
                  defaultValue={programFilter ?? ""}
                  placeholder="All Programs"
                  options={programs.map((program) => ({ value: program.id, label: program.code ? `${program.code} - ${program.name}` : program.name }))}
                />
                <Select
                  name="status"
                  defaultValue={status ?? ""}
                  placeholder="All Statuses"
                  options={STATUS_OPTIONS}
                />
                <Select
                  name="packetType"
                  defaultValue={packetType ?? ""}
                  placeholder="All Packet Types"
                  options={PACKET_TYPE_OPTIONS}
                />
                <Select
                  name="formType"
                  defaultValue={formType ?? ""}
                  placeholder="All Types"
                  options={FORM_TYPE_OPTIONS}
                />
                <div className="flex gap-2">
                  <Button type="submit" size="sm"><Filter className="h-4 w-4" /> Apply</Button>
                  <Link href="/templates"><Button type="button" variant="secondary" size="sm">Reset</Button></Link>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Document Template Table */}
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-3 pb-3">
              <div>
                <CardTitle>Document Templates</CardTitle>
                <CardDescription>{filteredDocTemplates.length} of {docTemplates.length} document templates shown</CardDescription>
              </div>
              {canManage && (
                <Link href="/templates/new">
                  <Button variant="secondary" size="sm"><Upload className="h-4 w-4" /> Upload Form</Button>
                </Link>
              )}
            </CardHeader>
            <CardContent className="p-0">
              {filteredDocTemplates.length === 0 ? (
                <div className="px-6 py-16">
                  <EmptyState title="No matching document templates" description="Try adjusting the program, packet type, status, or search filters." icon={<FileText className="h-8 w-8" />} />
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-surface-200">
                        <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Template Name</th>
                        <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Category</th>
                        <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Program</th>
                        <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Version</th>
                        <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                        <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Mappings</th>
                        <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Updated</th>
                        <th className="pb-3 pr-6 text-right text-xs font-semibold uppercase tracking-wider text-surface-500">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-100">
                      {filteredDocTemplates.map((template) => {
                        const mappedTypes = getDocPacketTypes(template)
                        return (
                          <tr key={template.id} className="transition-colors hover:bg-surface-50">
                            <td className="py-3 pl-6 pr-4">
                              <div className="flex items-center gap-3">
                                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50">
                                  <FileText className="h-4 w-4 text-brand-600" />
                                </div>
                                <div className="min-w-0">
                                  <p className="truncate font-medium text-surface-900">{template.name}</p>
                                  <p className="truncate text-xs text-surface-500">{template.description || formatFileSize(template.fileSize)}</p>
                                </div>
                              </div>
                            </td>
                            <td className="py-3 pr-4"><Badge variant={template.formType === "dhs" ? "default" : "secondary"} size="sm">{formTypeLabel(template.formType)}</Badge></td>
                            <td className="py-3 pr-4 text-xs text-surface-600">{programLabel(template.program, programs)}</td>
                            <td className="py-3 pr-4 text-xs font-medium text-surface-700">v{template.version}</td>
                            <td className="py-3 pr-4"><StatusChip status={template.status} size="sm" /></td>
                            <td className="py-3 pr-4">
                              <div className="flex flex-wrap gap-1">
                                {mappedTypes.slice(0, 2).map((type) => <Badge key={type} variant="outline" size="sm">{packetTypeLabel(type)}</Badge>)}
                                {mappedTypes.length > 2 && <Badge variant="secondary" size="sm">+{mappedTypes.length - 2}</Badge>}
                                {mappedTypes.length === 0 && <span className="text-xs text-surface-400">Unmapped</span>}
                              </div>
                            </td>
                            <td className="py-3 pr-4 text-xs text-surface-500">{formatDate(template.updatedAt)}</td>
                            <td className="py-3 pr-6">
                              <div className="flex justify-end gap-1">
                                <a href={signUrl(template.fileKey)} target="_blank" rel="noopener noreferrer" title="Download template">
                                  <Button variant="ghost" size="icon-sm" type="button"><Download className="h-4 w-4" /></Button>
                                </a>
                                <Link href={`/library?tab=templates&search=${encodeURIComponent(template.name)}`} title="View in library">
                                  <Button variant="ghost" size="icon-sm" type="button"><ExternalLink className="h-4 w-4" /></Button>
                                </Link>
                                <Button variant="ghost" size="icon-sm" type="button" disabled title="Template detail editing is not part of this pass"><MoreHorizontal className="h-4 w-4" /></Button>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Packet Template Cards */}
          <Card id="packet-templates">
            <CardHeader className="flex-row items-center justify-between gap-3">
              <div>
                <CardTitle>Packet Templates</CardTitle>
                <CardDescription>{filteredPacketTemplates.length} packet definitions with required and optional mappings</CardDescription>
              </div>
              {canManage && (
                <Link href="/templates/new?tab=packet">
                  <Button variant="secondary" size="sm"><Plus className="h-4 w-4" /> New Packet Template</Button>
                </Link>
              )}
            </CardHeader>
            <CardContent>
              {filteredPacketTemplates.length === 0 ? (
                <EmptyState title="No matching packet templates" description="Packet template definitions will appear here after creation." icon={<Layers className="h-8 w-8" />} />
              ) : (
                <div className="grid gap-4 lg:grid-cols-2">
                  {filteredPacketTemplates.map((template) => {
                    const required = template.requiredDocs.filter((doc) => doc.required)
                    const optional = template.requiredDocs.filter((doc) => !doc.required)
                    return (
                      <div key={template.id} className="rounded-lg border border-surface-200 bg-white p-4 transition-colors hover:border-brand-200 hover:bg-brand-50/20">
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex min-w-0 items-start gap-3">
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                              <ScrollText className="h-5 w-5 text-violet-600" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-surface-900">{template.name}</p>
                              <div className="mt-1 flex flex-wrap gap-1.5">
                                <Badge variant="secondary" size="sm">{packetTypeLabel(template.packetType)}</Badge>
                                {template.program && <Badge variant="outline" size="sm">{template.program.code || template.program.name}</Badge>}
                                {template.isDefault && <Badge variant="info" size="sm">Default</Badge>}
                              </div>
                            </div>
                          </div>
                          <StatusChip status={template.status} size="sm" />
                        </div>

                        {template.description && <p className="mt-3 line-clamp-2 text-xs text-surface-500">{template.description}</p>}

                        <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                          <MetricPill label="Total docs" value={template.requiredDocs.length} />
                          <MetricPill label="Required" value={required.length} />
                          <MetricPill label="Optional" value={optional.length} />
                        </div>

                        <div className="mt-4 space-y-2">
                          {template.requiredDocs.slice(0, 4).map((row) => (
                            <div key={row.id} className="flex items-center justify-between gap-3 text-xs">
                              <span className="min-w-0 truncate text-surface-700">{row.sortOrder + 1}. {row.documentTemplate.name}</span>
                              <Badge variant={row.required ? "warning" : "secondary"} size="sm">{row.required ? "Required" : "Optional"}</Badge>
                            </div>
                          ))}
                          {template.requiredDocs.length > 4 && <p className="text-xs text-surface-400">+{template.requiredDocs.length - 4} more mapped documents</p>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </main>

        {/* Right Sidebar */}
        <aside className="space-y-4">
          <SelectedTemplatePanel
            template={selectedTemplate}
            packetTypes={selectedTemplatePacketTypes}
            packetTemplates={selectedTemplatePacketTemplates}
            programs={programs}
          />
          <TemplateHealthPanel docTemplates={docTemplates} packetTemplates={packetTemplates} />
          {recentActivity.length > 0 && <ActivityPanel events={recentActivity} />}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm">Quick Actions</CardTitle>
              <CardDescription>Direct links preserved from the working app</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <Link href="/library?tab=templates">
                <Button variant="secondary" size="sm" className="w-full"><Library className="h-4 w-4" /> Open Document Library</Button>
              </Link>
              <Link href="/packets/new">
                <Button variant="secondary" size="sm" className="w-full"><FolderOpen className="h-4 w-4" /> Create Client Packet</Button>
              </Link>
            </CardContent>
          </Card>
        </aside>
      </div>

      {selectedTemplate && (
        <Card>
          <CardHeader>
            <CardTitle>Template Details</CardTitle>
            <CardDescription>Selected-template details using stored template metadata and packet mappings</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            <DetailBlock
              title="Template Information"
              rows={[
                ["Description", selectedTemplate.description || "No description"],
                ["Type", formTypeLabel(selectedTemplate.formType)],
                ["Program", programLabel(selectedTemplate.program, programs)],
                ["Version", `v${selectedTemplate.version}`],
                ["Uploaded by", selectedTemplate.uploadedBy?.name || selectedTemplate.uploadedBy?.email || "Unknown"],
              ]}
            />
            <div className="rounded-lg border border-surface-200 p-4">
              <p className="text-sm font-semibold text-surface-900">Program Assignment</p>
              <div className="mt-3 grid gap-2 sm:grid-cols-2">
                {programs.slice(0, 4).map((program) => {
                  const assigned = docMatchesProgram(selectedTemplate, program, program.id)
                  return (
                    <div key={program.id} className="rounded-lg border border-surface-200 bg-surface-50 p-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-xs font-medium text-surface-700">{program.code || program.name}</span>
                        <Badge variant={assigned ? "success" : "secondary"} size="sm">{assigned ? "Assigned" : "Not assigned"}</Badge>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
            <div className="rounded-lg border border-surface-200 p-4">
              <p className="text-sm font-semibold text-surface-900">Mapping Summary</p>
              <div className="mt-3 space-y-3">
                <MetricLine label="Packet templates" value={selectedTemplatePacketTemplates.length} />
                <MetricLine label="Packet types" value={selectedTemplatePacketTypes.length} />
                <MetricLine label="Packet documents created" value={selectedTemplate._count.packetDocuments} />
                <MetricLine label="Last updated" value={formatDate(selectedTemplate.updatedAt)} />
              </div>
              {selectedTemplatePacketTemplates.length > 0 && (
                <Link href={templatesHref(currentFilters, { packetType: selectedTemplatePacketTemplates[0].packetType })} className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-700 hover:text-brand-800">
                  View mapped packet type <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}

function SummaryCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
}: {
  label: string
  value: number
  sub: string
  icon: React.ComponentType<{ className?: string }>
  tone: "success" | "brand" | "warning" | "info" | "violet" | "surface"
}) {
  const tones = {
    success: "bg-success-50 text-success-600",
    brand: "bg-brand-50 text-brand-600",
    warning: "bg-warning-50 text-warning-600",
    info: "bg-sky-50 text-sky-600",
    violet: "bg-violet-50 text-violet-600",
    surface: "bg-surface-100 text-surface-600",
  }
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-surface-500">
          <span className={`flex h-7 w-7 items-center justify-center rounded-lg ${tones[tone]}`}>
            <Icon className="h-4 w-4" />
          </span>
          <span className="text-xs font-medium">{label}</span>
        </div>
        <p className="mt-3 text-2xl font-bold text-surface-900">{value}</p>
        <p className="mt-1 text-xs text-surface-400">{sub}</p>
      </CardContent>
    </Card>
  )
}

function CategoryLink({ label, count, href, active }: { label: string; count: number; href: string; active?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors ${active ? "bg-brand-50 text-brand-700" : "text-surface-600 hover:bg-surface-50 hover:text-surface-900"}`}
    >
      <span className="truncate">{label}</span>
      <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${active ? "bg-brand-100 text-brand-700" : "bg-surface-100 text-surface-500"}`}>{count}</span>
    </Link>
  )
}

function MetricPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg bg-surface-50 px-2 py-2">
      <p className="text-base font-semibold text-surface-900">{value}</p>
      <p className="text-[10px] font-medium uppercase tracking-wide text-surface-400">{label}</p>
    </div>
  )
}

function MetricLine({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className="text-surface-500">{label}</span>
      <span className="font-medium text-surface-900">{value}</span>
    </div>
  )
}

function DetailBlock({ title, rows }: { title: string; rows: [string, string][] }) {
  return (
    <div className="rounded-lg border border-surface-200 p-4">
      <p className="text-sm font-semibold text-surface-900">{title}</p>
      <div className="mt-3 space-y-3">
        {rows.map(([label, value]) => (
          <MetricLine key={label} label={label} value={value} />
        ))}
      </div>
    </div>
  )
}

function SelectedTemplatePanel({
  template,
  packetTypes,
  packetTemplates,
  programs,
}: {
  template: DocumentTemplate | null
  packetTypes: string[]
  packetTemplates: PacketTemplate[]
  programs: Program[]
}) {
  if (!template) {
    return (
      <Card>
        <CardContent className="py-12">
          <EmptyState title="No template selected" description="Upload or create a template to see its details." icon={<ScrollText className="h-8 w-8" />} />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{template.name}</CardTitle>
            <CardDescription>Version {template.version} - {programLabel(template.program, programs)}</CardDescription>
          </div>
          <StatusChip status={template.status} size="sm" />
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-lg border border-surface-200 bg-surface-50 p-4">
          <div className="mx-auto flex h-48 max-w-36 flex-col rounded-md border border-surface-200 bg-white p-3 shadow-sm">
            <div className="h-5 w-20 rounded bg-brand-100" />
            <div className="mt-4 space-y-2">
              <div className="h-2 rounded bg-surface-200" />
              <div className="h-2 rounded bg-surface-200" />
              <div className="h-2 w-3/4 rounded bg-surface-200" />
            </div>
            <div className="mt-5 grid grid-cols-2 gap-2">
              <div className="h-8 rounded border border-surface-200" />
              <div className="h-8 rounded border border-surface-200" />
              <div className="h-8 rounded border border-surface-200" />
              <div className="h-8 rounded border border-surface-200" />
            </div>
            <div className="mt-auto h-2 w-16 rounded bg-surface-200" />
          </div>
        </div>

        <div className="mt-4 space-y-3">
          <MetricLine label="Category" value={formTypeLabel(template.formType)} />
          <MetricLine label="File size" value={formatFileSize(template.fileSize)} />
          <MetricLine label="Packet mappings" value={packetTemplates.length} />
          <MetricLine label="Updated" value={formatDate(template.updatedAt)} />
        </div>

        {packetTypes.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-1.5">
            {packetTypes.map((type) => <Badge key={type} variant="outline" size="sm">{packetTypeLabel(type)}</Badge>)}
          </div>
        )}

        <div className="mt-4 flex gap-2">
          <a href={signUrl(template.fileKey)} target="_blank" rel="noopener noreferrer" className="flex-1">
            <Button variant="secondary" size="sm" className="w-full"><Download className="h-4 w-4" /> Download</Button>
          </a>
          <Link href={`/library?tab=templates&search=${encodeURIComponent(template.name)}`} className="flex-1">
            <Button size="sm" className="w-full"><ExternalLink className="h-4 w-4" /> Library</Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  )
}

function TemplateHealthPanel({
  docTemplates,
  packetTemplates,
}: {
  docTemplates: DocumentTemplate[]
  packetTemplates: PacketTemplate[]
}) {
  const unmapped = docTemplates.filter((template) => !packetTemplates.some((packetTemplate) => packetTemplate.requiredDocs.some((doc) => doc.documentTemplate.id === template.id))).length
  const draft = docTemplates.filter((template) => template.status === "draft").length + packetTemplates.filter((template) => template.status === "draft").length
  const retired = docTemplates.filter((template) => template.status === "retired").length + packetTemplates.filter((template) => template.status === "retired").length

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Template Status Summary</CardTitle>
        <CardDescription>Real lifecycle and mapping signals</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <HealthRow label="Unmapped document templates" value={unmapped} tone={unmapped > 0 ? "warning" : "success"} />
        <HealthRow label="Draft templates" value={draft} tone={draft > 0 ? "brand" : "success"} />
        <HealthRow label="Retired templates" value={retired} tone="surface" />
        <HealthRow label="Packet definitions" value={packetTemplates.length} tone="brand" />
      </CardContent>
    </Card>
  )
}

function HealthRow({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "brand" | "surface" }) {
  const colors = {
    success: "bg-success-50 text-success-700",
    warning: "bg-warning-50 text-warning-700",
    brand: "bg-brand-50 text-brand-700",
    surface: "bg-surface-100 text-surface-700",
  }
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-sm text-surface-600">{label}</span>
      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${colors[tone]}`}>{value}</span>
    </div>
  )
}

function ActivityPanel({ events }: { events: TemplateActivity[] }) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm">Recent Template Activity</CardTitle>
        <CardDescription>From AuditEvent records</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {events.map((event) => (
          <div key={event.id} className="flex gap-3">
            <div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-brand-500" />
            <div className="min-w-0">
              <p className="line-clamp-2 text-sm font-medium text-surface-800">{activityLabel(event)}</p>
              <p className="text-xs text-surface-400">{event.actor?.name || event.actor?.email || "System"} - {formatDateTime(event.createdAt)}</p>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  )
}