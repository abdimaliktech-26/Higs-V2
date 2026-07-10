"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { getPortalDocumentRequestHistory } from "@/lib/actions/portal-document-requests"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/states"
import { UploadCloud, FileCheck2, Lock, Clock, History } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"

interface SupportingDocRow { id: string; originalFileName: string | null; fileSize: number | null; mimeType: string; createdAt: string | Date }
interface RequestRow {
  id: string
  title: string
  description: string | null
  category: string
  priority: string
  isRequired: boolean
  dueDate: string | Date | null
  status: string
  createdAt: string | Date
  supportingDocuments: SupportingDocRow[]
}

interface Props { requests: RequestRow[] }

const categoryLabels: Record<string, string> = {
  INSURANCE: "Insurance", IDENTIFICATION: "Identification", MEDICATION: "Medication",
  CARE_PLAN: "Care Plan", LEGAL: "Legal", CONSENT: "Consent", PHOTO: "Photo", OTHER: "Other",
}

const timelineLabels: Record<string, string> = {
  REQUESTED: "Requested by your care team",
  UPLOADED: "You uploaded a document",
  RESUBMITTED: "You uploaded a replacement document",
  CANCELLED: "Request cancelled",
}

const UPLOADABLE_STATUSES = ["PENDING", "NEEDS_REPLACEMENT"]
const ACCEPT = ".pdf,.jpg,.jpeg,.png,.heic,.docx"

function formatBytes(bytes: number | null): string {
  if (!bytes) return ""
  const mb = bytes / (1024 * 1024)
  return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`
}

export function UploadCenterManager({ requests }: Props) {
  const router = useRouter()
  const [progress, setProgress] = useState<Record<string, number>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [success, setSuccess] = useState<Record<string, boolean>>({})
  const [history, setHistory] = useState<Record<string, { id: string; eventType: string; note: string | null; createdAt: string }[]>>({})
  const [historyOpen, setHistoryOpen] = useState<Record<string, boolean>>({})
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({})

  function uploadFile(requestId: string, file: File) {
    setErrors((prev) => ({ ...prev, [requestId]: "" }))
    setSuccess((prev) => ({ ...prev, [requestId]: false }))
    setProgress((prev) => ({ ...prev, [requestId]: 0 }))

    const formData = new FormData()
    formData.append("file", file)

    const xhr = new XMLHttpRequest()
    xhr.open("POST", `/api/portal-upload/${requestId}`)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress((prev) => ({ ...prev, [requestId]: Math.round((e.loaded / e.total) * 100) }))
    }
    xhr.onload = () => {
      try {
        const body = JSON.parse(xhr.responseText)
        if (xhr.status === 200 && body.success) {
          setSuccess((prev) => ({ ...prev, [requestId]: true }))
          router.refresh()
        } else {
          setErrors((prev) => ({ ...prev, [requestId]: body.error || "Upload failed" }))
        }
      } catch {
        setErrors((prev) => ({ ...prev, [requestId]: "Upload failed" }))
      }
      setProgress((prev) => ({ ...prev, [requestId]: 0 }))
    }
    xhr.onerror = () => {
      setErrors((prev) => ({ ...prev, [requestId]: "Connection lost. Please try again." }))
      setProgress((prev) => ({ ...prev, [requestId]: 0 }))
    }
    xhr.send(formData)
  }

  function handleFileSelect(requestId: string, files: FileList | null) {
    const file = files?.[0]
    if (file) uploadFile(requestId, file)
  }

  function handleDrop(requestId: string, e: React.DragEvent) {
    e.preventDefault()
    const file = e.dataTransfer.files?.[0]
    if (file) uploadFile(requestId, file)
  }

  async function toggleHistory(requestId: string) {
    const isOpen = historyOpen[requestId]
    setHistoryOpen((prev) => ({ ...prev, [requestId]: !isOpen }))
    if (!isOpen && !history[requestId]) {
      const events = await getPortalDocumentRequestHistory(requestId)
      setHistory((prev) => ({ ...prev, [requestId]: events as any }))
    }
  }

  if (requests.length === 0) {
    return (
      <Card>
        <CardContent className="py-16">
          <EmptyState title="No Documents Requested" description="Your care team has not requested any documents." icon={<UploadCloud className="h-8 w-8" />} />
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Alert variant="info">
        <Lock className="h-3.5 w-3.5" /> Your files are encrypted and securely transmitted. Maximum file size 25 MB. Accepted: PDF, JPG, PNG, HEIC, DOCX.
      </Alert>

      {requests.map((r) => {
        const canUpload = UPLOADABLE_STATUSES.includes(r.status)
        const pct = progress[r.id] || 0
        return (
          <Card key={r.id}>
            <CardContent className="space-y-3 pt-6">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-medium text-surface-900">{r.title}</p>
                  {r.description && <p className="text-sm text-surface-500">{r.description}</p>}
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="outline" size="sm">{categoryLabels[r.category] || r.category}</Badge>
                    {r.priority === "HIGH" && <Badge variant="danger" size="sm">High Priority</Badge>}
                    {!r.isRequired && <Badge variant="outline" size="sm">Optional</Badge>}
                  </div>
                </div>
                <div className="text-right">
                  <StatusChip status={r.status.toLowerCase()} size="sm" />
                  {r.dueDate && <p className="mt-1 flex items-center gap-1 text-xs text-surface-500"><Clock className="h-3 w-3" /> Due {formatDate(r.dueDate)}</p>}
                </div>
              </div>

              {r.status === "NEEDS_REPLACEMENT" && (
                <Alert variant="warning">Your care team has requested a replacement for this document.</Alert>
              )}

              {errors[r.id] && (
                <Alert variant="error">
                  {errors[r.id]}
                  <Button size="sm" variant="secondary" className="ml-3" onClick={() => fileInputRefs.current[r.id]?.click()}>Retry</Button>
                </Alert>
              )}

              {success[r.id] && (
                <Alert variant="success">Document uploaded successfully. Your care team has been notified. Status: Pending Review.</Alert>
              )}

              {canUpload && (
                <div
                  className="flex flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-surface-300 bg-surface-50 p-6 text-center transition-colors hover:border-brand-400"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => handleDrop(r.id, e)}
                >
                  <UploadCloud className="h-8 w-8 text-surface-400" />
                  <p className="text-sm text-surface-600">Drag & drop a file here, or</p>
                  <input
                    ref={(el) => { fileInputRefs.current[r.id] = el }}
                    type="file"
                    accept={ACCEPT}
                    className="hidden"
                    onChange={(e) => handleFileSelect(r.id, e.target.files)}
                  />
                  <Button size="sm" onClick={() => fileInputRefs.current[r.id]?.click()}>Browse Files</Button>
                  {pct > 0 && (
                    <div className="mt-2 h-2 w-full max-w-xs overflow-hidden rounded-full bg-surface-200">
                      <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
                    </div>
                  )}
                </div>
              )}

              {r.supportingDocuments.length > 0 && (
                <div className="space-y-1 rounded-lg border border-surface-100 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-surface-400">Uploaded</p>
                  {r.supportingDocuments.map((doc) => (
                    <div key={doc.id} className="flex items-center justify-between text-sm">
                      <span className="flex items-center gap-1.5 text-surface-700"><FileCheck2 className="h-3.5 w-3.5 text-success-600" /> {doc.originalFileName || "Uploaded file"}</span>
                      <span className="text-xs text-surface-400">{formatBytes(doc.fileSize)} · {formatDateTime(doc.createdAt)}</span>
                    </div>
                  ))}
                </div>
              )}

              <button onClick={() => toggleHistory(r.id)} className="flex items-center gap-1 text-xs text-surface-500 hover:text-brand-700">
                <History className="h-3.5 w-3.5" /> {historyOpen[r.id] ? "Hide history" : "View history"}
              </button>
              {historyOpen[r.id] && history[r.id] && (
                <div className="space-y-1 border-l-2 border-surface-200 pl-3">
                  {history[r.id].map((e) => (
                    <div key={e.id} className="text-xs text-surface-500">
                      <span className="text-surface-700">{timelineLabels[e.eventType] || e.eventType}</span> — {formatDateTime(e.createdAt)}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
