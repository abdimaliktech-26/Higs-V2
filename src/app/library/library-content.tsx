import { getLibraryDocuments, getLibraryDashboardSummary } from "@/lib/actions/library"
import { signStaffFileUrl, type StaffFileResourceType } from "@/lib/storage"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { SearchInput } from "@/components/ui/search-input"
import {
  FileText, Library, Upload, Download, Eye, Lock, ExternalLink, ClipboardCheck,
} from "lucide-react"
import { formatDate } from "@/lib/utils"
import Link from "next/link"
import { LibraryDashboard } from "./library-dashboard"
import { SupportingUploadForm } from "./supporting-upload-form"

interface Props { orgId?: string; isSuperAdmin: boolean; tab?: string; search?: string; status?: string }

const LIBRARY_TABS = [
  { value: "active", label: "Active Documents" },
  { value: "templates", label: "Templates" },
  { value: "approved", label: "Approved / Archived" },
  { value: "supporting", label: "Supporting" },
]


export async function LibraryContent({ orgId, isSuperAdmin, tab, search, status }: Props) {
  if (isSuperAdmin && !orgId) {
    return <div className="space-y-6">
      <PageHeader />
      <Card><CardContent className="py-16"><EmptyState title="Switch to an organization" description="Select an organization to view its document library." icon={<Library className="h-8 w-8" />} /></CardContent></Card>
    </div>
  }

  let data: Awaited<ReturnType<typeof getLibraryDocuments>>
  let summary: Awaited<ReturnType<typeof getLibraryDashboardSummary>>
  try {
    [data, summary] = await Promise.all([
      getLibraryDocuments(orgId!, { tab, search, status }),
      getLibraryDashboardSummary(orgId!),
    ])
  } catch (e) {
    return <ErrorState title="Error" description={(e as Error).message} />
  }

  const activeTab = tab || "active"
  const totalDocs = data.packetDocs.length + data.templates.length + data.supportingDocs.length

  return (
    <div className="space-y-6">
      <PageHeader total={totalDocs} />

      <LibraryDashboard
        totalActive={summary.totalActive}
        totalLocked={summary.totalLocked}
        totalTemplates={summary.totalTemplates}
        totalSupporting={summary.totalSupporting}
        totalDocuments={summary.totalDocuments}
        awaitingSignature={summary.awaitingSignature}
        statusBreakdown={summary.statusBreakdown}
        recentActivity={summary.recentActivity}
      />

      <div className="flex items-center justify-between">
        <nav className="flex border-b border-surface-200">
          {LIBRARY_TABS.map((t) => (
            <Link
              key={t.value}
              href={`/library?tab=${t.value}`}
              className={`relative px-4 py-3 text-sm font-medium transition-colors ${
                activeTab === t.value ? "text-brand-700" : "text-surface-500 hover:text-surface-700"
              }`}
            >
              {t.label}
              {activeTab === t.value && <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-brand-600 rounded-full" />}
            </Link>
          ))}
        </nav>
        <Link href="/library?tab=supporting#upload">
          <Button size="sm"><Upload className="h-4 w-4" /> Upload</Button>
        </Link>
      </div>

      <div className="flex gap-3">
        <div className="flex-1">
          <form>
            <input type="hidden" name="tab" value={activeTab} />
            <SearchInput name="search" placeholder="Search documents..." defaultValue={search} />
          </form>
        </div>
      </div>

      {activeTab === "templates" && (
        <TemplateSection templates={data.templates} />
      )}

      {(activeTab === "active" || activeTab === "approved") && (
        <PacketDocSection docs={data.packetDocs} tab={activeTab} />
      )}

      {activeTab === "supporting" && (
        <>
          <SupportingUploadForm />
          <SupportingSection docs={data.supportingDocs} />
        </>
      )}

      {activeTab !== "templates" && activeTab !== "supporting" && data.packetDocs.length === 0 && (
        <Card><CardContent className="py-16"><EmptyState title="No documents" description={activeTab === "approved" ? "No approved or archived documents yet" : "Create packets and add documents to see them here"} icon={<FileText className="h-8 w-8" />} /></CardContent></Card>
      )}

      {activeTab === "templates" && data.templates.length === 0 && (
        <Card><CardContent className="py-16"><EmptyState title="No templates" description="Upload form templates in Templates & Forms Manager" icon={<FileText className="h-8 w-8" />} /></CardContent></Card>
      )}

      {activeTab === "supporting" && data.supportingDocs.length === 0 && (
        <Card><CardContent className="py-16"><EmptyState title="No supporting documents" description="Upload supporting documents like assessments, reports, or external records" icon={<FileText className="h-8 w-8" />} /></CardContent></Card>
      )}
    </div>
  )
}

function PageHeader({ total }: { total?: number }) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Document Library</h1>
        <p className="mt-1 text-sm text-surface-500">{total !== undefined ? `${total} document${total !== 1 ? "s" : ""} in current view` : "Central document repository"}</p>
      </div>
      <Link href="/data-migration"><Button variant="secondary" size="sm"><ClipboardCheck className="h-4 w-4" /> Data Import Readiness</Button></Link>
    </div>
  )
}

function DownloadLink({ resourceType, resourceId, fileKey }: { resourceType: StaffFileResourceType; resourceId: string; fileKey: string | null | undefined }) {
  if (!fileKey) return <Button variant="ghost" size="icon-sm" disabled title="No file on record"><Download className="h-4 w-4" /></Button>
  return (
    <a href={signStaffFileUrl(resourceType, resourceId)} target="_blank" rel="noopener noreferrer" title="Download (signed link, expires in 5 minutes)">
      <Button variant="ghost" size="icon-sm" type="button"><Download className="h-4 w-4" /></Button>
    </a>
  )
}

function TemplateSection({ templates }: { templates: any[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200">
              <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Template</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Type</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Program</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Version</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Uploaded</th>
              <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {templates.map((tpl) => (
              <tr key={tpl.id} className="hover:bg-surface-50 transition-colors">
                <td className="py-3 pl-6 pr-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-brand-600 shrink-0" />
                    <span className="font-medium text-surface-900">{tpl.name}</span>
                  </div>
                </td>
                <td className="py-3 pr-4"><Badge variant="secondary" size="sm">{tpl.formType}</Badge></td>
                <td className="py-3 pr-4 text-xs text-surface-600">{tpl.program || "—"}</td>
                <td className="py-3 pr-4 text-xs text-surface-600">v{tpl.version}</td>
                <td className="py-3 pr-4"><StatusChip status={tpl.status} size="sm" /></td>
                <td className="py-3 pr-4 text-xs text-surface-500">{tpl.uploadedBy?.name || "—"}</td>
                <td className="py-3 pr-6"><DownloadLink resourceType="document_template" resourceId={tpl.id} fileKey={tpl.fileKey} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function PacketDocSection({ docs, tab }: { docs: any[]; tab: string }) {
  const filtered = tab === "approved"
    ? docs.filter(d => d.packet?.status === "approved" || d.packet?.status === "archived")
    : docs.filter(d => d.packet?.status !== "approved" && d.packet?.status !== "archived")

  if (filtered.length === 0) return null

  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200">
              <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Document</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Packet</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Version</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
              <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {filtered.map((doc) => (
              <tr key={doc.id} className="hover:bg-surface-50 transition-colors">
                <td className="py-3 pl-6 pr-4">
                  <div className="flex items-center gap-3">
                    {tab === "approved" ? <Lock className="h-5 w-5 text-success-500 shrink-0" /> : <FileText className="h-5 w-5 text-brand-600 shrink-0" />}
                    <div>
                      <span className="font-medium text-surface-900">{doc.documentTemplate.name}</span>
                      {tab === "approved" && <p className="text-[10px] uppercase tracking-wide text-success-600">Locked</p>}
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-4">
                  <span className="text-sm text-surface-700">{doc.packet?.client?.firstName} {doc.packet?.client?.lastName}</span>
                </td>
                <td className="py-3 pr-4">
                  {doc.packet?.id ? (
                    <Link href={`/packets/${doc.packet.id}`} className="inline-flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700 capitalize">
                      {doc.packet.packetType?.replace(/_/g, " ")} <ExternalLink className="h-3 w-3" />
                    </Link>
                  ) : "—"}
                </td>
                <td className="py-3 pr-4 text-xs text-surface-600">v{doc.currentVersion}</td>
                <td className="py-3 pr-4"><StatusChip status={doc.status} size="sm" /></td>
                <td className="py-3 pr-6">
                  <div className="flex items-center gap-1">
                    <Link href={`/documents/${doc.id}/edit`}>
                      <Button variant="ghost" size="icon-sm" title="Open in PDF Editor"><Eye className="h-4 w-4" /></Button>
                    </Link>
                    <DownloadLink resourceType="packet_document" resourceId={doc.id} fileKey={doc.documentTemplate.fileKey} />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}

function SupportingSection({ docs }: { docs: any[] }) {
  return (
    <Card>
      <CardContent className="p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-surface-200">
              <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Document</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Category</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Uploaded By</th>
              <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Date</th>
              <th className="pb-3 pr-6 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {docs.map((doc) => (
              <tr key={doc.id} className="hover:bg-surface-50 transition-colors">
                <td className="py-3 pl-6 pr-4">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-violet-500 shrink-0" />
                    <div>
                      <p className="font-medium text-surface-900">{doc.title}</p>
                      {doc.description && <p className="text-xs text-surface-500">{doc.description}</p>}
                    </div>
                  </div>
                </td>
                <td className="py-3 pr-4"><Badge variant="secondary" size="sm">{doc.category}</Badge></td>
                <td className="py-3 pr-4 text-sm text-surface-600">{doc.client ? `${doc.client.firstName} ${doc.client.lastName}` : "—"}</td>
                <td className="py-3 pr-4 text-xs text-surface-500">{doc.uploadedBy?.name || "—"}</td>
                <td className="py-3 pr-4 text-xs text-surface-500">{formatDate(doc.createdAt)}</td>
                <td className="py-3 pr-6"><DownloadLink resourceType="supporting_document" resourceId={doc.id} fileKey={doc.fileKey} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  )
}
