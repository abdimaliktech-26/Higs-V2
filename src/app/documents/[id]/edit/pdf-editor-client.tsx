"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import {
  addDocumentComment,
  addPdfField,
  createPdfVersion,
  getEditableDocument,
  saveDocumentFields,
} from "@/lib/actions/documents"
import { AiCopilotPanel } from "@/components/ai/copilot-panel"
import { FieldOverlays } from "@/components/pdf/field-overlays"
import { PDFRenderer } from "@/components/pdf/pdf-renderer"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Separator } from "@/components/ui/separator"
import { AccessDeniedState, EmptyState, ErrorState, LoadingState } from "@/components/ui/states"
import { StatusChip } from "@/components/ui/status-chip"
import { Textarea } from "@/components/ui/textarea"
import { cn, formatDateTime } from "@/lib/utils"
import {
  AlertTriangle,
  BookOpen,
  Bookmark,
  Calendar,
  CheckCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Circle,
  Download,
  Edit3,
  EyeOff,
  FileText,
  Highlighter,
  History,
  Layers,
  Lock,
  Maximize2,
  MessageSquare,
  MoreHorizontal,
  PanelLeftOpen,
  PanelRightOpen,
  Plus,
  Save,
  Search,
  Settings,
  Star,
  User,
  ZoomIn,
  ZoomOut,
} from "lucide-react"

interface Props {
  documentId: string
}

type InspectorTab = "validation" | "ai" | "comments" | "versions"

const DOCUMENT_TABS = [
  "Admission Form",
  "Support Plan",
  "ISP",
  "Emergency Plan",
  "Rights",
  "Risk Assessment",
]

const PACKET_SECTIONS = [
  { name: "INTAKE", rows: ["Admission Form", "Rights", "Risk Assessment"] },
  { name: "CARE PLAN", rows: ["Support Plan", "ISP", "Emergency Plan"] },
  { name: "REVIEWS", rows: ["Quarterly Review", "Annual Review"] },
  { name: "SIGNATURES", rows: ["Guardian Signature", "Staff Signature"] },
  { name: "ATTACHMENTS", rows: ["Medical Records", "Supporting Docs"] },
  { name: "CUSTOM", rows: ["Custom Addendum"] },
]

export function PDFEditorClient({ documentId }: Props) {
  const [doc, setDoc] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const [saving, setSaving] = useState(false)
  const [saveMsg, setSaveMsg] = useState<string | null>(null)

  const [fields, setFields] = useState<any[]>([])
  const [selectedField, setSelectedField] = useState<string | null>(null)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>("validation")
  const [commentText, setCommentText] = useState("")
  const [totalPages, setTotalPages] = useState(0)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [showLeftPanel, setShowLeftPanel] = useState(true)
  const [showRightPanel, setShowRightPanel] = useState(true)

  const loadDoc = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAccessDenied(false)
    try {
      const data = await getEditableDocument(documentId)
      setDoc(data)
      setFields(data.fields || [])
    } catch (e: any) {
      if (e.message?.includes("denied") || e.message?.includes("permission")) setAccessDenied(true)
      else setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [documentId])

  useEffect(() => {
    loadDoc()
  }, [loadDoc])

  async function handleSave() {
    setSaving(true)
    const result = await saveDocumentFields(documentId, fields.map((f: any) => ({
      id: f.id,
      name: f.name,
      fieldType: f.fieldType,
      value: f.value,
      pageNumber: f.pageNumber,
      posX: f.posX,
      posY: f.posY,
      isRequired: f.isRequired,
    })))
    if (result.success) {
      setSaveMsg("Saved at " + new Date().toLocaleTimeString())
      setTimeout(() => setSaveMsg(null), 3000)
      await createPdfVersion(documentId, `Auto-save v${(doc?.versions?.length || 0) + 1}`)
      loadDoc()
    }
    setSaving(false)
  }

  async function handleAddComment() {
    if (!commentText.trim()) return
    await addDocumentComment(documentId, commentText)
    setCommentText("")
    loadDoc()
  }

  if (loading) return <LoadingState title="Loading document..." />
  if (accessDenied) return <AccessDeniedState title="Access Denied" description="You do not have permission to edit this document." />
  if (error) return <ErrorState title="Error" description={error} />
  if (!doc) return <EmptyState title="Document not found" icon={<FileText className="h-8 w-8" />} />

  const packet = doc.packet
  const client = packet.client
  const hasPdf = !!doc.pdfUrl
  const isReadOnly = doc?.isReadOnly ?? false
  const isLockedByApproval = doc?.isLockedByApproval ?? false
  const readOnly = isReadOnly || isLockedByApproval

  const requiredFields = fields.filter((f: any) => f.isRequired)
  const completedFields = fields.filter(fieldHasValue)
  const missingRequired = requiredFields.filter((f: any) => !fieldHasValue(f))
  const signatureFields = fields.filter((f: any) => signatureType(f.fieldType))
  const completedSignatures = signatureFields.filter(fieldHasValue)
  const warningFields = fields.filter((f: any) => !f.isRequired && !fieldHasValue(f))
  const completionPct = fields.length ? Math.round((completedFields.length / fields.length) * 100) : 0
  const signatureRemaining = Math.max(signatureFields.length - completedSignatures.length, 0)
  const validationStatus = missingRequired.length > 0 ? "Needs Review" : warningFields.length > 0 ? "Warnings" : "Clear"
  const assignedStaff = packet.assignedTo?.name || "Unassigned"
  const lastSaved = saveMsg || formatDateTime(doc.updatedAt)
  const pageCount = totalPages || 1

  const jumpToField = (field: any) => {
    setSelectedField(field.id)
    setCurrentPage(field.pageNumber || 1)
    setInspectorTab("validation")
  }

  return (
    <div className="flex h-[calc(100vh-7rem)] min-h-[720px] flex-col overflow-hidden rounded-xl border border-surface-200 bg-surface-50 shadow-sm">
      <PacketDocumentHeader
        doc={doc}
        packet={packet}
        client={client}
        completionPct={completionPct}
        validationStatus={validationStatus}
        missingRequired={missingRequired.length}
        warningCount={warningFields.length}
        signatureFields={signatureFields.length}
        signatureRemaining={signatureRemaining}
        assignedStaff={assignedStaff}
        lastSaved={lastSaved}
        saveMsg={saveMsg}
        saving={saving}
        readOnly={readOnly}
        isReadOnly={isReadOnly}
        isLockedByApproval={isLockedByApproval}
        currentPage={currentPage}
        totalPages={pageCount}
        scale={scale}
        onSave={handleSave}
        onPageChange={setCurrentPage}
        onScaleChange={setScale}
        onInspectorTab={setInspectorTab}
      />

      {isLockedByApproval && (
        <div className="flex shrink-0 items-center gap-2 border-b border-success-200 bg-success-50 px-5 py-2 text-sm text-success-800">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <span className="font-medium">Document approved and locked</span>
          <span className="text-success-700">- editing disabled</span>
        </div>
      )}

      <DocumentTabs
        activeDocumentName={doc.documentTemplate.name}
        completionPct={completionPct}
        missingRequired={missingRequired.length}
        signatureRemaining={signatureRemaining}
      />

      <div className="flex min-h-0 flex-1 overflow-hidden bg-surface-100">
        {showLeftPanel && (
          <>
            <PacketNavigator
              activeDocumentName={doc.documentTemplate.name}
              completionPct={completionPct}
              missingRequired={missingRequired.length}
              signatureRemaining={signatureRemaining}
              assignedStaff={assignedStaff}
              updatedAt={doc.updatedAt}
            />
            <ThumbnailRail
              totalPages={pageCount}
              currentPage={currentPage}
              fields={fields}
              onPageChange={setCurrentPage}
            />
          </>
        )}

        <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-100">
          <div className="flex shrink-0 items-center justify-between border-b border-surface-200 bg-white px-4 py-2">
            <div className="flex items-center gap-2 text-xs text-surface-500">
              <FileText className="h-4 w-4 text-brand-600" />
              <span className="font-medium text-surface-700">PDF Canvas</span>
              <span>{hasPdf ? "Live PDF.js renderer" : "PDF unavailable"}</span>
            </div>
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon-sm" onClick={() => setShowLeftPanel(!showLeftPanel)} title={showLeftPanel ? "Hide packet navigator" : "Show packet navigator"}>
                <PanelLeftOpen className="h-4 w-4" />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => setShowRightPanel(!showRightPanel)} title={showRightPanel ? "Hide inspector" : "Show inspector"}>
                <PanelRightOpen className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {hasPdf ? (
            <div className="relative min-h-0 flex-1 overflow-hidden">
              <PDFRenderer
                url={doc.pdfUrl}
                pageNumber={currentPage}
                scale={scale}
                showToolbar={false}
                onPageCount={setTotalPages}
                onPageChange={setCurrentPage}
                onScaleChange={setScale}
                className="h-full"
              >
                <FieldOverlays
                  fields={fields}
                  currentPage={currentPage}
                  scale={scale}
                  onFieldClick={(fieldId) => {
                    setSelectedField(fieldId)
                    setInspectorTab("validation")
                  }}
                  selectedFieldId={selectedField}
                />
              </PDFRenderer>
              <FloatingPageToolbar onInspectorTab={setInspectorTab} />
            </div>
          ) : (
            <NoPdfWorkspace fields={fields} />
          )}
        </main>

        {showRightPanel && (
          <RightInspector
            tab={inspectorTab}
            onTabChange={setInspectorTab}
            fields={fields}
            selectedField={selectedField}
            onSelectField={setSelectedField}
            onFieldsChange={setFields}
            onJumpToField={jumpToField}
            isReadOnly={readOnly}
            documentId={documentId}
            onFieldAdded={loadDoc}
            comments={doc.comments || []}
            commentText={commentText}
            onCommentChange={setCommentText}
            onAddComment={handleAddComment}
            versions={doc.versions || []}
          />
        )}
      </div>

      <BottomStatusBar
        autosave={saveMsg ? "Saved" : saving ? "Saving" : "Ready"}
        version={doc.currentVersion}
        currentPage={currentPage}
        totalPages={pageCount}
        scale={scale}
        completedFields={completedFields.length}
        remainingFields={Math.max(fields.length - completedFields.length, 0)}
        missingRequired={missingRequired.length}
        completionPct={completionPct}
      />
    </div>
  )
}

function PacketDocumentHeader({
  doc,
  packet,
  client,
  completionPct,
  validationStatus,
  missingRequired,
  warningCount,
  signatureFields,
  signatureRemaining,
  assignedStaff,
  lastSaved,
  saveMsg,
  saving,
  readOnly,
  isReadOnly,
  isLockedByApproval,
  currentPage,
  totalPages,
  scale,
  onSave,
  onPageChange,
  onScaleChange,
  onInspectorTab,
}: any) {
  return (
    <header className="shrink-0 border-b border-surface-200 bg-white">
      <div className="flex flex-col gap-4 px-5 py-4 xl:flex-row xl:items-start xl:justify-between">
        <div className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-center gap-2 text-xs text-surface-500">
            <Link href="/clients" className="hover:text-brand-700">Clients</Link>
            <span>&gt;</span>
            <span className="font-medium text-surface-700">{client.firstName} {client.lastName}</span>
            <span>&gt;</span>
            <Link href={`/packets/${doc.packetId}`} className="hover:text-brand-700">{labelize(packet.packetType)}</Link>
            <span>&gt;</span>
            <span className="font-medium text-surface-700">{doc.documentTemplate.name}</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand-50 ring-1 ring-brand-100">
              <FileText className="h-5 w-5 text-brand-700" />
            </div>
            <div className="min-w-0">
              <h1 className="truncate text-2xl font-semibold tracking-tight text-surface-950">{doc.documentTemplate.name}</h1>
              <p className="mt-0.5 text-sm text-surface-500">
                {client.mcadId || "No MCAD ID"} - {packet.program?.name || "Program not assigned"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={doc.documentTemplate.formType === "dhs" ? "default" : "secondary"} size="sm">
                Official DHS
              </Badge>
              <StatusChip status={doc.status} size="sm" />
              <Badge variant="warning" size="sm">
                <Star className="mr-1 h-3 w-3" />
                Favorite
              </Badge>
              {isLockedByApproval && <Badge variant="success" size="sm"><Lock className="mr-1 h-3 w-3" />Approved</Badge>}
              {isReadOnly && <Badge variant="outline" size="sm"><EyeOff className="mr-1 h-3 w-3" />Read-only</Badge>}
            </div>
          </div>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-8">
            <HeaderMetric label="Packet Status" value={<StatusChip status={packet.status} size="sm" />} />
            <HeaderMetric label="Validation Status" value={validationStatus} tone={missingRequired > 0 ? "danger" : warningCount > 0 ? "warning" : "success"} />
            <HeaderMetric label="Signature Status" value={signatureFields ? `${signatureFields - signatureRemaining}/${signatureFields}` : "None"} tone={signatureRemaining > 0 ? "warning" : "success"} />
            <HeaderMetric label="Version" value={`v${doc.currentVersion}`} />
            <HeaderMetric label="Last Saved" value={lastSaved} />
            <HeaderMetric label="Assigned Staff" value={assignedStaff} />
            <HeaderMetric label="Autosave" value={saveMsg ? "Saved just now" : saving ? "Saving..." : "Ready"} tone={saveMsg ? "success" : undefined} />
            <HeaderMetric label="Packet Completion" value={`${completionPct}%`} tone={completionPct >= 80 ? "success" : completionPct >= 50 ? "warning" : "danger"} />
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-2 xl:items-end">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={onSave} loading={saving} disabled={readOnly}>
              <Save className="h-4 w-4" />
              {saving ? "Saving..." : "Save"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => onInspectorTab("validation")}>
              <CheckCircle2 className="h-4 w-4" />
              Validate
            </Button>
            <Button variant="secondary" size="sm" disabled title="Signature request workflow is preserved outside this UI pass">
              <User className="h-4 w-4" />
              Request Signatures
            </Button>
            <Button variant="ghost" size="icon-sm" title="More actions">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>

          <EditorToolbar
            currentPage={currentPage}
            totalPages={totalPages}
            scale={scale}
            onPageChange={onPageChange}
            onScaleChange={onScaleChange}
            onInspectorTab={onInspectorTab}
          />
        </div>
      </div>
    </header>
  )
}

function HeaderMetric({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-surface-50 px-3 py-2">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">{label}</p>
      <div className={cn(
        "mt-1 truncate text-xs font-semibold text-surface-800",
        tone === "success" && "text-success-700",
        tone === "warning" && "text-warning-700",
        tone === "danger" && "text-danger-700"
      )}>
        {value}
      </div>
    </div>
  )
}

function EditorToolbar({ currentPage, totalPages, scale, onPageChange, onScaleChange, onInspectorTab }: any) {
  const fieldTools = [
    ["Text", FileText],
    ["Checkbox", CheckCircle],
    ["Radio", Circle],
    ["Dropdown", Layers],
    ["Date", Calendar],
    ["Signature", Edit3],
    ["Initials", User],
  ] as const

  return (
    <div className="flex max-w-full flex-wrap items-center gap-1 rounded-xl border border-surface-200 bg-surface-50 p-1">
      <ToolbarGroup>
        <ToolButton label="Pointer" active icon={<FileText className="h-4 w-4" />} />
        <ToolButton label="Hand" icon={<BookOpen className="h-4 w-4" />} />
      </ToolbarGroup>
      <ToolbarGroup>
        {fieldTools.map(([label, Icon]) => (
          <ToolButton key={label} label={label} icon={<Icon className="h-4 w-4" />} />
        ))}
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolButton label="Highlight" icon={<Highlighter className="h-4 w-4" />} />
        <ToolButton label="Draw" icon={<Edit3 className="h-4 w-4" />} />
        <ToolButton label="Comment" icon={<MessageSquare className="h-4 w-4" />} onClick={() => onInspectorTab("comments")} />
        <ToolButton label="Compare" icon={<History className="h-4 w-4" />} onClick={() => onInspectorTab("versions")} />
        <ToolButton label="Validation" icon={<CheckCircle2 className="h-4 w-4" />} onClick={() => onInspectorTab("validation")} />
      </ToolbarGroup>
      <ToolbarGroup>
        <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(Math.max(1, currentPage - 1))} disabled={currentPage <= 1} title="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="min-w-[5.5ch] text-center text-xs font-medium text-surface-600">{currentPage}/{totalPages}</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onPageChange(Math.min(totalPages, currentPage + 1))} disabled={currentPage >= totalPages} title="Next page">
          <ChevronRight className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={() => onScaleChange(Math.max(0.75, scale - 0.25))} disabled={scale <= 0.75} title="Zoom out">
          <ZoomOut className="h-4 w-4" />
        </Button>
        <span className="min-w-[4ch] text-center text-xs font-medium text-surface-600">{Math.round(scale * 100)}%</span>
        <Button variant="ghost" size="icon-sm" onClick={() => onScaleChange(Math.min(3, scale + 0.25))} disabled={scale >= 3} title="Zoom in">
          <ZoomIn className="h-4 w-4" />
        </Button>
      </ToolbarGroup>
      <ToolbarGroup>
        <ToolButton label="Fullscreen" icon={<Maximize2 className="h-4 w-4" />} />
        <ToolButton label="Search" icon={<Search className="h-4 w-4" />} />
        <ToolButton label="Settings" icon={<Settings className="h-4 w-4" />} />
      </ToolbarGroup>
    </div>
  )
}

function ToolbarGroup({ children }: { children: React.ReactNode }) {
  return <div className="flex items-center gap-0.5 border-r border-surface-200 pr-1 last:border-r-0 last:pr-0">{children}</div>
}

function ToolButton({ label, icon, active, onClick }: { label: string; icon: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
        "inline-flex h-8 min-w-8 items-center justify-center rounded-lg px-2 text-surface-500 transition-colors hover:bg-white hover:text-surface-800 hover:shadow-sm",
        active && "bg-white text-brand-700 shadow-sm ring-1 ring-brand-100"
      )}
    >
      {icon}
      <span className="sr-only">{label}</span>
    </button>
  )
}

function DocumentTabs({ activeDocumentName, completionPct, missingRequired, signatureRemaining }: any) {
  const activeIndex = Math.max(0, DOCUMENT_TABS.findIndex((label) => normalized(activeDocumentName).includes(normalized(label)) || normalized(label).includes(normalized(activeDocumentName))))

  return (
    <div className="shrink-0 border-b border-surface-200 bg-white px-4">
      <div className="flex overflow-x-auto">
        {DOCUMENT_TABS.map((label, index) => {
          const active = index === activeIndex
          const complete = active ? completionPct : 0
          const validation = active ? missingRequired : 0
          const signature = active ? signatureRemaining : 0
          return (
            <button
              key={label}
              type="button"
              className={cn(
                "relative flex min-w-[170px] flex-col gap-1 border-r border-surface-100 px-4 py-3 text-left transition-colors",
                active ? "bg-brand-50/70" : "hover:bg-surface-50"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <span className={cn("truncate text-sm font-semibold", active ? "text-brand-800" : "text-surface-700")}>{label}</span>
                <span className={cn("h-2 w-2 rounded-full", validation > 0 ? "bg-danger-500" : "bg-success-500")} />
              </div>
              <div className="flex items-center gap-2 text-[10px] text-surface-500">
                <span>{complete}% complete</span>
                <span>{validation} validation</span>
                <span>{signature} sig</span>
              </div>
              {active && <span className="absolute inset-x-0 bottom-0 h-0.5 bg-brand-600" />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function PacketNavigator({ activeDocumentName, completionPct, missingRequired, signatureRemaining, assignedStaff, updatedAt }: any) {
  return (
    <aside className="flex w-72 shrink-0 flex-col overflow-hidden border-r border-surface-200 bg-white">
      <div className="border-b border-surface-200 px-4 py-3">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-surface-400">Packet Navigator</p>
            <p className="mt-1 text-sm font-semibold text-surface-900">Document Packet</p>
          </div>
          <Layers className="h-5 w-5 text-brand-600" />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {PACKET_SECTIONS.map((section) => (
          <div key={section.name} className="mb-5 last:mb-0">
            <p className="mb-2 px-1 text-[10px] font-bold uppercase tracking-widest text-surface-400">{section.name}</p>
            <div className="space-y-1.5">
              {section.rows.map((title, index) => {
                const active = normalized(activeDocumentName).includes(normalized(title)) || (section.name === "INTAKE" && index === 0)
                return (
                  <button
                    key={`${section.name}-${title}`}
                    type="button"
                    className={cn(
                      "w-full rounded-xl border p-3 text-left transition-all",
                      active
                        ? "border-brand-200 bg-brand-50 shadow-sm"
                        : "border-surface-200 bg-white hover:border-surface-300 hover:bg-surface-50"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", active ? "bg-brand-100 text-brand-700" : "bg-surface-100 text-surface-500")}>
                        <FileText className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="truncate text-sm font-semibold text-surface-900">{active ? activeDocumentName : title}</p>
                          <span className="text-[10px] font-semibold text-surface-500">{active ? `${completionPct}%` : "0%"}</span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-x-2 gap-y-1 text-[10px] text-surface-500">
                          <span>Validation: {active ? missingRequired : 0}</span>
                          <span>Signatures: {active ? signatureRemaining : 0}</span>
                          <span className="truncate">Staff: {active ? assignedStaff : "Unassigned"}</span>
                          <span className="truncate">Updated: {active ? formatDateTime(updatedAt) : "Pending"}</span>
                        </div>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </aside>
  )
}

function ThumbnailRail({ totalPages, currentPage, fields, onPageChange }: any) {
  return (
    <aside className="flex w-28 shrink-0 flex-col overflow-hidden border-r border-surface-200 bg-surface-50">
      <div className="border-b border-surface-200 px-3 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-surface-400">Pages</p>
        <p className="mt-1 text-xs text-surface-500">{totalPages} page{totalPages === 1 ? "" : "s"}</p>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-3">
        {Array.from({ length: totalPages }).map((_, i) => {
          const page = i + 1
          const active = currentPage === page
          return (
            <button
              key={page}
              type="button"
              onClick={() => onPageChange(page)}
              className={cn("group w-full text-left", active && "text-brand-700")}
            >
              <div className={cn(
                "relative h-28 rounded-lg border bg-white shadow-sm transition-all group-hover:border-brand-200 group-hover:shadow-md",
                active ? "border-brand-400 ring-2 ring-brand-100" : "border-surface-200"
              )}>
                <div className="absolute inset-3 space-y-2">
                  <div className="h-2 rounded bg-surface-200" />
                  <div className="h-2 w-4/5 rounded bg-surface-100" />
                  <div className="h-12 rounded border border-surface-100 bg-surface-50" />
                  <div className="h-2 w-2/3 rounded bg-surface-100" />
                </div>
                {active && <span className="absolute left-0 top-3 h-10 w-1 rounded-r-full bg-brand-600" />}
              </div>
              <div className="mt-1 flex items-center justify-between px-1">
                <span className="text-xs font-medium">Page {page}</span>
                <span className="text-[10px] text-surface-400">{fields.filter((f: any) => f.pageNumber === page).length}</span>
              </div>
            </button>
          )
        })}
      </div>
    </aside>
  )
}

function FloatingPageToolbar({ onInspectorTab }: { onInspectorTab: (tab: InspectorTab) => void }) {
  const items = [
    { label: "Bookmark", icon: <Bookmark className="h-4 w-4" /> },
    { label: "Annotation", icon: <Edit3 className="h-4 w-4" />, tab: "validation" as InspectorTab },
    { label: "Comment", icon: <MessageSquare className="h-4 w-4" />, tab: "comments" as InspectorTab },
    { label: "History", icon: <History className="h-4 w-4" />, tab: "versions" as InspectorTab },
  ]

  return (
    <div className="absolute left-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-2 rounded-xl border border-surface-200 bg-white p-1 shadow-lg">
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          title={item.label}
          onClick={() => item.tab && onInspectorTab(item.tab)}
          className="flex h-9 w-9 items-center justify-center rounded-lg text-surface-500 transition-colors hover:bg-brand-50 hover:text-brand-700"
        >
          {item.icon}
          <span className="sr-only">{item.label}</span>
        </button>
      ))}
    </div>
  )
}

function NoPdfWorkspace({ fields }: { fields: any[] }) {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-surface-100 p-8">
      <div className="w-full max-w-2xl rounded-xl border border-surface-200 bg-white p-8 text-center shadow-sm">
        <FileText className="mx-auto mb-4 h-14 w-14 text-surface-300" />
        <h3 className="text-base font-semibold text-surface-800">PDF File Not Available</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-surface-500">
          The original PDF template file has not been uploaded or stored. Field editing remains available as structured metadata.
        </p>
        <div className="mt-6 grid gap-2 text-left">
          {fields.length > 0 ? fields.map((field: any, idx: number) => (
            <div key={field.id} className="flex items-center gap-3 rounded-lg border border-surface-200 bg-surface-50 p-3">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-white text-xs font-bold text-surface-500">{idx + 1}</div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-surface-900">{field.name}</p>
                <p className="text-xs capitalize text-surface-500">{field.fieldType}</p>
              </div>
              {fieldHasValue(field) ? <CheckCircle className="h-4 w-4 text-success-500" /> : <Circle className="h-4 w-4 text-warning-500" />}
            </div>
          )) : (
            <p className="text-sm text-surface-400">No fields have been added yet.</p>
          )}
        </div>
      </div>
    </div>
  )
}

function RightInspector({
  tab,
  onTabChange,
  fields,
  selectedField,
  onSelectField,
  onFieldsChange,
  onJumpToField,
  isReadOnly,
  documentId,
  onFieldAdded,
  comments,
  commentText,
  onCommentChange,
  onAddComment,
  versions,
}: any) {
  const tabs: { value: InspectorTab; label: string; count?: number }[] = [
    { value: "validation", label: "Validation", count: fields.filter((f: any) => f.isRequired && !fieldHasValue(f)).length },
    { value: "ai", label: "AI" },
    { value: "comments", label: "Comments", count: comments.length },
    { value: "versions", label: "Versions", count: versions.length },
  ]

  return (
    <aside className="flex w-[360px] shrink-0 flex-col overflow-hidden border-l border-surface-200 bg-white">
      <div className="border-b border-surface-200 px-4 py-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-surface-400">Right Inspector</p>
        <div className="mt-3 grid grid-cols-4 rounded-lg bg-surface-100 p-1">
          {tabs.map((item) => (
            <button
              key={item.value}
              type="button"
              onClick={() => onTabChange(item.value)}
              className={cn(
                "rounded-md px-2 py-2 text-xs font-semibold transition-colors",
                tab === item.value ? "bg-white text-brand-700 shadow-sm" : "text-surface-500 hover:text-surface-800"
              )}
            >
              {item.label}
              {item.count !== undefined && <span className="ml-1 text-[10px] opacity-70">{item.count}</span>}
            </button>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {tab === "validation" && (
          <ValidationPanel
            fields={fields}
            selectedField={selectedField}
            onSelectField={onSelectField}
            onFieldsChange={onFieldsChange}
            onJumpToField={onJumpToField}
            isReadOnly={isReadOnly}
            documentId={documentId}
            onFieldAdded={onFieldAdded}
          />
        )}
        {tab === "ai" && <AiInspectorPanel documentId={documentId} fields={fields} />}
        {tab === "comments" && (
          <CommentsPanel
            comments={comments}
            commentText={commentText}
            onCommentChange={onCommentChange}
            onAdd={onAddComment}
            disabled={isReadOnly}
          />
        )}
        {tab === "versions" && <VersionPanel versions={versions} />}
      </div>
    </aside>
  )
}

function ValidationPanel({
  fields,
  selectedField,
  onSelectField,
  onFieldsChange,
  onJumpToField,
  isReadOnly,
  documentId,
  onFieldAdded,
}: any) {
  const requiredFields = fields.filter((f: any) => f.isRequired)
  const missingFields = requiredFields.filter((f: any) => !fieldHasValue(f))
  const warningFields = fields.filter((f: any) => !f.isRequired && !fieldHasValue(f))
  const completedFields = fields.filter(fieldHasValue)
  const completionRate = fields.length ? Math.round((completedFields.length / fields.length) * 100) : 0

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-surface-200 bg-surface-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-surface-900">Validation Summary</p>
            <p className="mt-1 text-xs text-surface-500">Required fields, warnings, and completion</p>
          </div>
          <Badge variant={missingFields.length ? "danger" : warningFields.length ? "warning" : "success"} size="sm">
            {missingFields.length ? "Needs Review" : warningFields.length ? "Warnings" : "Clear"}
          </Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <SummaryTile label="Critical" value={missingFields.length} tone="danger" />
          <SummaryTile label="Warning" value={warningFields.length} tone="warning" />
          <SummaryTile label="Missing" value={missingFields.length} tone="danger" />
        </div>
        <Progress className="mt-4" value={completionRate} size="sm" variant={completionRate >= 80 ? "success" : completionRate >= 50 ? "warning" : "danger"} label="Completed Fields" showValue />
      </section>

      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <p className="text-xs font-bold uppercase tracking-wider text-surface-400">Grouped Issues</p>
          <Button variant="secondary" size="sm" disabled title="No field-level AI fix action exists in this UI pass">
            Fix with AI
          </Button>
        </div>
        {missingFields.length === 0 && warningFields.length === 0 ? (
          <div className="rounded-xl border border-success-200 bg-success-50 p-4 text-sm text-success-800">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4" />
              No open validation issues
            </div>
            <p className="mt-1 text-xs text-success-700">The current field set has no missing required fields.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {missingFields.map((field: any) => (
              <IssueCard key={field.id} field={field} severity="critical" message="Required field is missing" onJump={() => onJumpToField(field)} />
            ))}
            {warningFields.slice(0, 4).map((field: any) => (
              <IssueCard key={field.id} field={field} severity="warning" message="Optional field has not been completed" onJump={() => onJumpToField(field)} />
            ))}
          </div>
        )}
      </section>

      <Separator />

      <FieldPanel
        fields={fields}
        selectedField={selectedField}
        onSelectField={onSelectField}
        onFieldsChange={onFieldsChange}
        isReadOnly={isReadOnly}
        documentId={documentId}
        onFieldAdded={onFieldAdded}
      />
    </div>
  )
}

function SummaryTile({ label, value, tone }: { label: string; value: number; tone: "success" | "warning" | "danger" }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-white p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">{label}</p>
      <p className={cn(
        "mt-1 text-xl font-semibold",
        tone === "success" && "text-success-700",
        tone === "warning" && "text-warning-700",
        tone === "danger" && "text-danger-700"
      )}>{value}</p>
    </div>
  )
}

function IssueCard({ field, severity, message, onJump }: any) {
  const danger = severity === "critical"
  return (
    <div className={cn("rounded-xl border bg-white p-3", danger ? "border-danger-200" : "border-warning-200")}>
      <div className="flex items-start gap-3">
        <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", danger ? "text-danger-600" : "text-warning-600")} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <Badge variant={danger ? "danger" : "warning"} size="sm">{severity}</Badge>
            <span className="truncate text-xs font-semibold text-surface-900">{field.name}</span>
          </div>
          <p className="mt-1 text-xs text-surface-500">{message}</p>
          <p className="mt-1 text-[10px] text-surface-400">Page {field.pageNumber || 1} - {labelize(field.fieldType)}</p>
        </div>
      </div>
      <Button variant="secondary" size="sm" className="mt-3 w-full" onClick={onJump}>Jump to Field</Button>
    </div>
  )
}

function FieldPanel({
  fields,
  selectedField,
  onSelectField,
  onFieldsChange,
  isReadOnly,
  documentId,
  onFieldAdded,
}: any) {
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState("text")
  const selected = fields.find((f: any) => f.id === selectedField)

  async function handleAddField() {
    if (!newName.trim() || isReadOnly) return
    const result = await addPdfField({ packetDocumentId: documentId, name: newName, fieldType: newType, pageNumber: 1 })
    if (result.success) {
      setNewName("")
      setAdding(false)
      onFieldAdded()
    }
  }

  function handleFieldValue(fieldId: string, value: string) {
    onFieldsChange((prev: any[]) => prev.map((f: any) => f.id === fieldId ? { ...f, value } : f))
  }

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-surface-900">Missing Fields</p>
          <p className="text-xs text-surface-500">{fields.length} total field{fields.length === 1 ? "" : "s"}</p>
        </div>
        {!isReadOnly && (
          <Button variant="secondary" size="sm" onClick={() => setAdding(!adding)}>
            <Plus className="h-4 w-4" />
            Add
          </Button>
        )}
      </div>

      {adding && (
        <div className="space-y-2 rounded-xl border border-surface-200 bg-surface-50 p-3">
          <Input placeholder="Field name" value={newName} onChange={(e) => setNewName(e.target.value)} autoFocus />
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value)}
            className="h-9 w-full rounded-lg border border-surface-300 bg-white px-2 text-xs text-surface-700"
          >
            <option value="text">Text</option>
            <option value="date">Date</option>
            <option value="checkbox">Checkbox</option>
            <option value="signature">Signature</option>
            <option value="textarea">Text Area</option>
            <option value="select">Dropdown</option>
          </select>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" className="flex-1" onClick={() => setAdding(false)}>Cancel</Button>
            <Button size="sm" className="flex-1" onClick={handleAddField}>Add</Button>
          </div>
        </div>
      )}

      <div className="max-h-56 space-y-1 overflow-y-auto rounded-xl border border-surface-200 bg-white p-1">
        {fields.map((field: any) => (
          <button
            key={field.id}
            type="button"
            onClick={() => onSelectField(field.id)}
            className={cn(
              "flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm transition-colors",
              selectedField === field.id ? "bg-brand-50 text-brand-700" : "text-surface-700 hover:bg-surface-50"
            )}
          >
            {fieldHasValue(field) ? <CheckCircle className="h-3.5 w-3.5 shrink-0 text-success-500" /> : <Circle className="h-3.5 w-3.5 shrink-0 text-warning-400" />}
            <span className="min-w-0 flex-1 truncate">{field.name}</span>
            <span className="text-[10px] capitalize text-surface-400">{field.fieldType}</span>
          </button>
        ))}
      </div>

      {selected && (
        <div className="space-y-3 rounded-xl border border-surface-200 bg-surface-50 p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-surface-900">{selected.name}</p>
              <p className="text-xs capitalize text-surface-500">{selected.fieldType} - Page {selected.pageNumber}</p>
            </div>
            {selected.isRequired && <Badge variant="warning" size="sm">Required</Badge>}
          </div>
          <div className="grid grid-cols-2 gap-2 text-xs text-surface-500">
            <span>Source: <strong className="capitalize text-surface-700">{selected.source}</strong></span>
            <span>Confidence: <strong className="text-surface-700">{selected.confidence !== null ? `${Math.round((selected.confidence || 0) * 100)}%` : "N/A"}</strong></span>
            <span>Position: <strong className="text-surface-700">{selected.posX !== null ? `${Math.round(selected.posX || 0)}, ${Math.round(selected.posY || 0)}` : "Auto"}</strong></span>
            <span>Status: <strong className={fieldHasValue(selected) ? "text-success-700" : "text-warning-700"}>{fieldHasValue(selected) ? "Complete" : "Missing"}</strong></span>
          </div>
          {!isReadOnly ? (
            selected.fieldType === "textarea" ? (
              <Textarea label="Value" value={selected.value || ""} onChange={(e) => handleFieldValue(selected.id, e.target.value)} rows={4} />
            ) : (
              <Input label="Value" value={selected.value || ""} onChange={(e) => handleFieldValue(selected.id, e.target.value)} />
            )
          ) : selected.value ? (
            <div>
              <p className="mb-1 text-xs font-medium text-surface-500">Value</p>
              <div className="rounded-lg border border-surface-200 bg-white px-3 py-2 text-sm text-surface-900">{selected.value}</div>
            </div>
          ) : null}
        </div>
      )}
    </section>
  )
}

function AiInspectorPanel({ documentId, fields }: { documentId: string; fields: any[] }) {
  const missing = fields.filter((f: any) => f.isRequired && !fieldHasValue(f))
  const completed = fields.filter(fieldHasValue)
  const confidence = fields.length ? Math.round((completed.length / fields.length) * 100) : 0

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-brand-100 bg-brand-50 p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-semibold text-brand-900">AI Suggestions</p>
            <p className="mt-1 text-xs text-brand-700">Copilot recommendations use the existing AI workflow.</p>
          </div>
          <Badge variant="default" size="sm">{confidence}% confidence</Badge>
        </div>
      </section>

      <div className="space-y-2">
        {(missing.length ? missing.slice(0, 3) : fields.slice(0, 3)).map((field: any) => (
          <div key={field.id} className="rounded-xl border border-surface-200 bg-white p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-surface-900">{field.name}</p>
                <p className="mt-1 text-xs text-surface-500">{fieldHasValue(field) ? "Review extracted value" : "Suggested completion needed"}</p>
              </div>
              <Badge variant={fieldHasValue(field) ? "success" : "warning"} size="sm">{fieldHasValue(field) ? "Ready" : "Suggested"}</Badge>
            </div>
            <div className="mt-3 flex gap-2">
              <Button variant="secondary" size="sm" disabled className="flex-1">Apply</Button>
              <Button variant="ghost" size="sm" disabled className="flex-1">Explain</Button>
            </div>
          </div>
        ))}
      </div>

      <Separator />
      <AiCopilotPanel documentId={documentId} fields={fields} className="rounded-xl border border-surface-200 bg-white p-4" />
    </div>
  )
}

function CommentsPanel({ comments, commentText, onCommentChange, onAdd, disabled }: any) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-surface-900">Threaded Comments</p>
        <p className="text-xs text-surface-500">{comments.length} comment{comments.length === 1 ? "" : "s"} on this document</p>
      </div>
      {!disabled && (
        <div className="space-y-2 rounded-xl border border-surface-200 bg-surface-50 p-3">
          <Textarea placeholder="Add a comment..." value={commentText} onChange={(e) => onCommentChange(e.target.value)} rows={3} />
          <Button size="sm" className="w-full" onClick={onAdd} disabled={!commentText.trim()}>
            <MessageSquare className="h-4 w-4" />
            Add Comment
          </Button>
        </div>
      )}
      {comments.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-8 text-center">
          <MessageSquare className="mx-auto mb-2 h-6 w-6 text-surface-300" />
          <p className="text-xs text-surface-500">No comments yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {comments.map((comment: any) => (
            <div key={comment.id} className="rounded-xl border border-surface-200 bg-white p-3">
              <div className="flex gap-3">
                <Avatar size="sm">
                  <AvatarFallback name={comment.createdBy?.name || "Unknown"} />
                </Avatar>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-semibold text-surface-800">{comment.createdBy?.name || "Unknown"}</span>
                    <span className="ml-auto shrink-0 text-[10px] text-surface-400">{formatDateTime(comment.createdAt)}</span>
                  </div>
                  <div className="mt-2 border-l-2 border-surface-200 pl-3">
                    <p className="text-sm leading-6 text-surface-700">{comment.text}</p>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function VersionPanel({ versions }: { versions: any[] }) {
  return (
    <div className="space-y-4">
      <div>
        <p className="text-sm font-semibold text-surface-900">Version History</p>
        <p className="text-xs text-surface-500">{versions.length} saved version{versions.length === 1 ? "" : "s"}</p>
      </div>
      {versions.length === 0 ? (
        <div className="rounded-xl border border-surface-200 bg-white p-8 text-center">
          <History className="mx-auto mb-2 h-6 w-6 text-surface-300" />
          <p className="text-xs text-surface-500">No versions saved yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {versions.map((version: any) => (
            <div key={version.id} className="rounded-xl border border-surface-200 bg-white p-3">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-bold text-brand-700">v{version.version}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold text-surface-900">{version.comment || `Version ${version.version}`}</p>
                    <Badge variant="secondary" size="sm">PDF</Badge>
                  </div>
                  <p className="mt-1 text-xs text-surface-500">{version.createdBy?.name || "System"} - {formatDateTime(version.createdAt)}</p>
                  <div className="mt-3 flex gap-2">
                    {version.signedUrl ? (
                      <a href={version.signedUrl} target="_blank" rel="noopener noreferrer" className="flex-1">
                        <Button variant="secondary" size="sm" className="w-full">
                          <Download className="h-4 w-4" />
                          Download
                        </Button>
                      </a>
                    ) : (
                      <Button variant="secondary" size="sm" disabled className="flex-1">Download</Button>
                    )}
                    <Button variant="ghost" size="sm" disabled className="flex-1" title="Restore is not supported by the current workflow">Restore</Button>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function BottomStatusBar({
  autosave,
  version,
  currentPage,
  totalPages,
  scale,
  completedFields,
  remainingFields,
  missingRequired,
  completionPct,
}: any) {
  return (
    <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-surface-200 bg-white px-4 py-2 text-xs text-surface-500">
      <div className="flex flex-wrap items-center gap-4">
        <StatusDot label="Autosave" value={autosave} tone={autosave === "Saved" || autosave === "Ready" ? "success" : "warning"} />
        <span>Version <strong className="text-surface-800">v{version}</strong></span>
        <span>Current Page <strong className="text-surface-800">{currentPage}/{totalPages}</strong></span>
        <span>Zoom <strong className="text-surface-800">{Math.round(scale * 100)}%</strong></span>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <span>Completed Fields <strong className="text-success-700">{completedFields}</strong></span>
        <span>Remaining Fields <strong className="text-warning-700">{remainingFields}</strong></span>
        <span>Validation <strong className={missingRequired ? "text-danger-700" : "text-success-700"}>{missingRequired ? `${missingRequired} issues` : "Clear"}</strong></span>
        <span>Packet Completion <strong className="text-brand-700">{completionPct}%</strong></span>
        <StatusDot label="Connection" value="Online" tone="success" />
      </div>
    </footer>
  )
}

function StatusDot({ label, value, tone }: { label: string; value: string; tone: "success" | "warning" | "danger" }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn(
        "h-2 w-2 rounded-full",
        tone === "success" && "bg-success-500",
        tone === "warning" && "bg-warning-500",
        tone === "danger" && "bg-danger-500"
      )} />
      {label} <strong className="text-surface-800">{value}</strong>
    </span>
  )
}

function fieldHasValue(field: any) {
  return typeof field.value === "string" ? field.value.trim().length > 0 : Boolean(field.value)
}

function signatureType(type: string | null | undefined) {
  const value = (type || "").toLowerCase()
  return value.includes("signature") || value.includes("initial")
}

function labelize(value: string | null | undefined) {
  if (!value) return "Unknown"
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function normalized(value: string | null | undefined) {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}
