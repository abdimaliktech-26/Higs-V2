"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { getDocumentTemplateById } from "@/lib/actions/templates"
import {
  getDocumentTemplateFields,
  createDocumentTemplateField,
  updateDocumentTemplateField,
  deleteDocumentTemplateField,
} from "@/lib/actions/document-template-fields"
import { PDFRenderer } from "@/components/pdf/pdf-renderer"
import { TemplateFieldOverlay, DEFAULT_FIELD_WIDTH, DEFAULT_FIELD_HEIGHT, type TemplateFieldBox } from "@/components/pdf/template-field-overlay"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Alert } from "@/components/ui/alert"
import { LoadingState, ErrorState, AccessDeniedState, EmptyState } from "@/components/ui/states"
import { ArrowLeft, Plus, Trash2, ArrowUp, ArrowDown, Lock, ListChecks } from "lucide-react"

interface Props { templateId: string }

const FIELD_TYPE_OPTIONS = [
  { value: "text", label: "Text" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "signature", label: "Signature" },
  { value: "textarea", label: "Text Area" },
  { value: "select", label: "Dropdown" },
]

const FIELD_KEY_PATTERN = /^[a-z][a-z0-9_]*$/

export function TemplateFieldEditor({ templateId }: Props) {
  const [template, setTemplate] = useState<any>(null)
  const [fields, setFields] = useState<TemplateFieldBox[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [accessDenied, setAccessDenied] = useState(false)

  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [scale, setScale] = useState(1.25)
  const [adding, setAdding] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [newKey, setNewKey] = useState("")
  const [newName, setNewName] = useState("")
  const [newType, setNewType] = useState("text")
  const [newRequired, setNewRequired] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    setAccessDenied(false)
    try {
      const [tpl, tplFields] = await Promise.all([
        getDocumentTemplateById(templateId),
        getDocumentTemplateFields(templateId),
      ])
      if (!tpl) {
        setError("Template not found")
      } else {
        setTemplate(tpl)
        setFields(tplFields as TemplateFieldBox[])
      }
    } catch (e: any) {
      if (e.message?.includes("denied") || e.message?.includes("Access")) setAccessDenied(true)
      else setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [templateId])

  useEffect(() => { load() }, [load])

  if (loading) return <LoadingState title="Loading template field editor..." />
  if (accessDenied) return <AccessDeniedState />
  if (error || !template) return <ErrorState title="Could not load template" description={error || undefined} onRetry={load} />

  const isReadOnly = template.status === "retired"
  const selectedField = fields.find((f) => f.id === selectedFieldId) || null
  const requiredCount = fields.filter((f) => f.isRequired).length
  const signatureCount = fields.filter((f) => f.fieldType === "signature").length

  function nextCascadePosition() {
    const idx = fields.filter((f) => f.pageNumber === currentPage).length
    return { posX: 40 + (idx % 3) * 250, posY: 30 + Math.floor(idx / 3) * 80 }
  }

  async function handleCreate() {
    setActionError(null)
    if (!FIELD_KEY_PATTERN.test(newKey)) {
      setActionError("Field key must be lowercase snake_case, e.g. client_name")
      return
    }
    if (!newName.trim()) {
      setActionError("Name is required")
      return
    }
    const { posX, posY } = nextCascadePosition()
    const result = await createDocumentTemplateField(templateId, {
      fieldKey: newKey.trim(),
      name: newName.trim(),
      fieldType: newType,
      pageNumber: currentPage,
      posX, posY,
      width: DEFAULT_FIELD_WIDTH,
      height: DEFAULT_FIELD_HEIGHT,
      isRequired: newRequired,
      sortOrder: fields.length,
    })
    if (!result.success) { setActionError(result.error); return }
    setNewKey(""); setNewName(""); setNewType("text"); setNewRequired(false); setAdding(false)
    await load()
    setSelectedFieldId(result.data.id)
  }

  async function handleGeometryChange(fieldId: string, geometry: { posX: number; posY: number; width: number; height: number }) {
    setFields((prev) => prev.map((f) => (f.id === fieldId ? { ...f, ...geometry } : f)))
    const result = await updateDocumentTemplateField(fieldId, geometry)
    if (!result.success) { setActionError(result.error); await load() }
  }

  async function handleFieldSave(patch: Record<string, unknown>) {
    if (!selectedField) return
    setActionError(null)
    const result = await updateDocumentTemplateField(selectedField.id, patch)
    if (!result.success) { setActionError(result.error); return }
    await load()
  }

  async function handleDelete(fieldId: string) {
    if (!confirm("Delete this field?")) return
    setActionError(null)
    const result = await deleteDocumentTemplateField(fieldId)
    if (!result.success) { setActionError(result.error); return }
    if (selectedFieldId === fieldId) setSelectedFieldId(null)
    await load()
  }

  async function handleReorder(fieldId: string, direction: "up" | "down") {
    const sorted = [...fields].sort((a, b) => a.sortOrder - b.sortOrder)
    const idx = sorted.findIndex((f) => f.id === fieldId)
    const swapIdx = direction === "up" ? idx - 1 : idx + 1
    if (idx === -1 || swapIdx < 0 || swapIdx >= sorted.length) return
    const a = sorted[idx]
    const b = sorted[swapIdx]
    setActionError(null)
    await Promise.all([
      updateDocumentTemplateField(a.id, { sortOrder: b.sortOrder }),
      updateDocumentTemplateField(b.id, { sortOrder: a.sortOrder }),
    ])
    await load()
  }

  return (
    <div className="mx-auto max-w-7xl space-y-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <Link href="/templates" className="inline-flex items-center gap-1 text-sm text-surface-500 hover:text-brand-700">
            <ArrowLeft className="h-4 w-4" /> Back to Templates
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-surface-900 tracking-tight">{template.name}</h1>
          <p className="mt-1 flex items-center gap-2 text-sm text-surface-500">
            Version {template.version} <StatusChip status={template.status} size="sm" />
            {isReadOnly && <span className="inline-flex items-center gap-1 text-xs text-surface-400"><Lock className="h-3 w-3" /> Read-only (retired)</span>}
          </p>
        </div>
        <div className="flex gap-4 text-sm">
          <div className="text-center"><p className="text-xl font-semibold text-surface-900">{fields.length}</p><p className="text-xs text-surface-500">Fields</p></div>
          <div className="text-center"><p className="text-xl font-semibold text-warning-700">{requiredCount}</p><p className="text-xs text-surface-500">Required</p></div>
          <div className="text-center"><p className="text-xl font-semibold text-brand-700">{signatureCount}</p><p className="text-xs text-surface-500">Signature</p></div>
        </div>
      </div>

      {actionError && <Alert variant="error">{actionError}</Alert>}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="relative min-h-[600px] overflow-hidden rounded-xl border border-surface-200">
          <PDFRenderer
            url={template.signedFileUrl}
            pageNumber={currentPage}
            scale={scale}
            onPageChange={setCurrentPage}
            onScaleChange={setScale}
          >
            <TemplateFieldOverlay
              fields={fields}
              currentPage={currentPage}
              scale={scale}
              selectedFieldId={selectedFieldId}
              isReadOnly={isReadOnly}
              onSelect={setSelectedFieldId}
              onGeometryChange={handleGeometryChange}
            />
          </PDFRenderer>
        </div>

        <aside className="space-y-4">
          <div className="rounded-xl border border-surface-200 bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold text-surface-900">Fields</p>
              {!isReadOnly && (
                <Button size="sm" variant="secondary" onClick={() => setAdding(!adding)}>
                  <Plus className="h-4 w-4" /> Add
                </Button>
              )}
            </div>

            {adding && (
              <div className="mt-3 space-y-2 rounded-lg border border-surface-200 bg-surface-50 p-3">
                <Input placeholder="Field key (e.g. client_name)" value={newKey} onChange={(e) => setNewKey(e.target.value)} autoFocus />
                <Input placeholder="Field name (e.g. Client Name)" value={newName} onChange={(e) => setNewName(e.target.value)} />
                <select
                  value={newType}
                  onChange={(e) => setNewType(e.target.value)}
                  className="h-9 w-full rounded-lg border border-surface-300 bg-white px-2 text-xs text-surface-700"
                >
                  {FIELD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <Checkbox label="Required" checked={newRequired} onChange={(e) => setNewRequired(e.target.checked)} />
                <p className="text-xs text-surface-400">Adds on page {currentPage} — drag to reposition afterward.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => setAdding(false)}>Cancel</Button>
                  <Button size="sm" className="flex-1" onClick={handleCreate}>Add Field</Button>
                </div>
              </div>
            )}

            {fields.length === 0 ? (
              <div className="py-8">
                <EmptyState title="No fields yet" description={isReadOnly ? "This retired version has no fields." : "Add a field to get started."} icon={<ListChecks className="h-6 w-6" />} />
              </div>
            ) : (
              <div className="mt-3 max-h-72 space-y-1 overflow-y-auto">
                {[...fields].sort((a, b) => a.sortOrder - b.sortOrder).map((field, i, arr) => (
                  <div
                    key={field.id}
                    className={`flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm ${selectedFieldId === field.id ? "bg-brand-50" : "hover:bg-surface-50"}`}
                  >
                    <button type="button" onClick={() => { setSelectedFieldId(field.id); setCurrentPage(field.pageNumber) }} className="min-w-0 flex-1 truncate text-left">
                      <span className="truncate font-medium text-surface-800">{field.name}</span>
                      <span className="ml-1 text-[10px] capitalize text-surface-400">{field.fieldType}</span>
                    </button>
                    {field.isRequired && <span className="text-[10px] text-danger-500">*</span>}
                    {!isReadOnly && (
                      <>
                        <button type="button" onClick={() => handleReorder(field.id, "up")} disabled={i === 0} className="text-surface-400 hover:text-surface-700 disabled:opacity-30">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => handleReorder(field.id, "down")} disabled={i === arr.length - 1} className="text-surface-400 hover:text-surface-700 disabled:opacity-30">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </button>
                        <button type="button" onClick={() => handleDelete(field.id)} className="text-surface-400 hover:text-danger-600">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {selectedField && (
            <div className="space-y-3 rounded-xl border border-surface-200 bg-white p-4">
              <p className="text-sm font-semibold text-surface-900">Field Details</p>
              <Input label="Field Key" defaultValue={selectedField.fieldKey} disabled={isReadOnly} onBlur={(e) => e.target.value !== selectedField.fieldKey && handleFieldSave({ fieldKey: e.target.value })} />
              <Input label="Name" defaultValue={selectedField.name} disabled={isReadOnly} onBlur={(e) => e.target.value !== selectedField.name && handleFieldSave({ name: e.target.value })} />
              <div>
                <label className="mb-1 block text-xs font-medium text-surface-600">Field Type</label>
                <select
                  defaultValue={selectedField.fieldType}
                  disabled={isReadOnly}
                  onChange={(e) => handleFieldSave({ fieldType: e.target.value })}
                  className="h-9 w-full rounded-lg border border-surface-300 bg-white px-2 text-xs text-surface-700 disabled:opacity-60"
                >
                  {FIELD_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
              <Checkbox label="Required" checked={selectedField.isRequired} disabled={isReadOnly} onChange={(e) => handleFieldSave({ isRequired: e.target.checked })} />
              <div className="grid grid-cols-2 gap-2 text-xs text-surface-500">
                <span>Page: <strong className="text-surface-700">{selectedField.pageNumber}</strong></span>
                <span>Pos: <strong className="text-surface-700">{Math.round(selectedField.posX || 0)}, {Math.round(selectedField.posY || 0)}</strong></span>
              </div>
              <Badge variant="secondary" size="sm">{selectedField.fieldKey}</Badge>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
