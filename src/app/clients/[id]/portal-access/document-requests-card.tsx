"use client"

import { Fragment, useState } from "react"
import { useRouter } from "next/navigation"
import { createPortalDocumentRequest, cancelPortalDocumentRequest, markPortalDocumentUnderReview, reviewPortalDocumentRequest } from "@/lib/actions/portal-document-requests"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Modal } from "@/components/ui/modal"
import { Alert } from "@/components/ui/alert"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import { FilePlus2, FileStack, FileCheck2, History, ClipboardCheck } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"

interface SupportingDocRow {
  id: string
  originalFileName: string | null
  fileSize: number | null
  mimeType: string
  reviewStatus: string | null
  createdAt: string | Date
}

interface RequestRow {
  id: string
  title: string
  category: string
  priority: string
  isRequired: boolean
  dueDate: string | Date | null
  status: string
  requestedBy: { id: string; name: string | null; email: string }
  supportingDocuments: SupportingDocRow[]
}

interface ChecklistSummary {
  requiredTotal: number
  requiredCompleted: number
  remaining: number
  completionPercent: number
}

interface Props {
  clientId: string
  requests: RequestRow[]
  checklist: ChecklistSummary
}

const STATUS_BREAKDOWN_ORDER = ["PENDING", "SUBMITTED", "UNDER_REVIEW", "NEEDS_REPLACEMENT", "APPROVED"] as const
const STATUS_BREAKDOWN_LABELS: Record<string, string> = {
  PENDING: "Pending",
  SUBMITTED: "Submitted",
  UNDER_REVIEW: "Under Review",
  NEEDS_REPLACEMENT: "Needs Replacement",
  APPROVED: "Approved",
}

const categoryOptions = [
  { value: "INSURANCE", label: "Insurance" },
  { value: "IDENTIFICATION", label: "Identification" },
  { value: "MEDICATION", label: "Medication" },
  { value: "CARE_PLAN", label: "Care Plan" },
  { value: "LEGAL", label: "Legal" },
  { value: "CONSENT", label: "Consent" },
  { value: "PHOTO", label: "Photo" },
  { value: "OTHER", label: "Other" },
]
const categoryLabels: Record<string, string> = Object.fromEntries(categoryOptions.map((o) => [o.value, o.label]))

const priorityOptions = [
  { value: "NORMAL", label: "Normal" },
  { value: "LOW", label: "Low" },
  { value: "HIGH", label: "High" },
]

const reviewCategoryOptions = [
  { value: "PHOTO_QUALITY", label: "Photo Quality" },
  { value: "UNREADABLE", label: "Unreadable" },
  { value: "MISSING_PAGES", label: "Missing Pages" },
  { value: "WRONG_DOCUMENT", label: "Wrong Document" },
  { value: "INCOMPLETE", label: "Incomplete" },
  { value: "EXPIRED", label: "Expired" },
  { value: "MISMATCHED_INFO", label: "Mismatched Info" },
  { value: "OTHER", label: "Other" },
]

const severityOptions = [
  { value: "REQUIRED", label: "Required" },
  { value: "SUGGESTED", label: "Suggested" },
]

export function DocumentRequestsCard({ clientId, requests, checklist }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [expandedHistory, setExpandedHistory] = useState<Record<string, boolean>>({})
  const [reviewModal, setReviewModal] = useState<{ requestId: string; decision: "APPROVED" | "NEEDS_REPLACEMENT" } | null>(null)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewLoading, setReviewLoading] = useState(false)

  const activeRequests = requests.filter((r) => r.status !== "CANCELLED")
  const statusBreakdown = STATUS_BREAKDOWN_ORDER.map((status) => ({
    status,
    label: STATUS_BREAKDOWN_LABELS[status],
    count: activeRequests.filter((r) => r.status === status).length,
  })).filter((s) => s.count > 0)

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = new FormData(e.currentTarget)
    const data = {
      clientId,
      title: form.get("title") as string,
      description: form.get("description") as string,
      category: form.get("category") as string,
      priority: form.get("priority") as string,
      isRequired: form.get("isRequired") === "on",
      dueDate: form.get("dueDate") as string,
    }

    const result = await createPortalDocumentRequest(data)
    setLoading(false)
    if (result.success) {
      setShowCreate(false)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function handleCancel(requestId: string) {
    if (!confirm("Cancel this document request?")) return
    const result = await cancelPortalDocumentRequest(requestId)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  async function handleStartReview(requestId: string) {
    const result = await markPortalDocumentUnderReview(requestId)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  async function handleReviewSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!reviewModal) return
    setReviewLoading(true)
    setReviewError(null)

    const form = new FormData(e.currentTarget)
    const data = {
      decision: reviewModal.decision,
      note: form.get("note") as string,
      category: form.get("category") as string,
      severity: form.get("severity") as string,
    }

    const result = await reviewPortalDocumentRequest(reviewModal.requestId, data)
    setReviewLoading(false)
    if (result.success) {
      setReviewModal(null)
      router.refresh()
    } else {
      setReviewError(result.error)
    }
  }

  return (
    <>
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <FileStack className="h-5 w-5 text-surface-400" />
              <CardTitle>Document Requests</CardTitle>
            </div>
            <Button size="sm" onClick={() => setShowCreate(true)}><FilePlus2 className="h-4 w-4" /> New Request</Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="border-b border-surface-100 px-6 py-4">
            <div className="flex items-center gap-4">
              <ClipboardCheck className="h-7 w-7 shrink-0 text-brand-600" />
              <div className="flex-1">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-surface-900">Required Documents</p>
                  <p className="text-sm font-semibold text-surface-700">
                    {checklist.requiredCompleted} of {checklist.requiredTotal} completed
                  </p>
                </div>
                <Progress value={checklist.completionPercent} className="mt-2" />
                <p className="mt-1 text-xs text-surface-500">
                  {checklist.remaining === 0
                    ? "All required documents are complete."
                    : `${checklist.remaining} required document${checklist.remaining === 1 ? "" : "s"} remaining`}
                </p>
              </div>
            </div>
            {statusBreakdown.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {statusBreakdown.map((s) => (
                  <Badge key={s.status} variant="outline">{s.label}: {s.count}</Badge>
                ))}
              </div>
            )}
          </div>
          {activeRequests.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState title="No document requests yet" description="Ask this client's guardian to upload a specific document through the portal." icon={<FileStack className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Title</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Category</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Due</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Latest Upload</th>
                    <th className="pb-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {activeRequests.map((r) => {
                    const [latestUpload, ...priorUploads] = r.supportingDocuments
                    const historyOpen = !!expandedHistory[r.id]
                    return (
                      <Fragment key={r.id}>
                        <tr className="hover:bg-surface-50 transition-colors">
                          <td className="py-3 pl-6 pr-4">
                            <p className="font-medium text-surface-900">{r.title}</p>
                            {r.priority === "HIGH" && <Badge variant="danger" size="sm">High Priority</Badge>}
                            {!r.isRequired && <Badge variant="outline" size="sm">Optional</Badge>}
                          </td>
                          <td className="py-3 pr-4 text-surface-600">{categoryLabels[r.category] || r.category}</td>
                          <td className="py-3 pr-4 text-xs text-surface-500">{r.dueDate ? formatDate(r.dueDate) : "—"}</td>
                          <td className="py-3 pr-4"><StatusChip status={r.status.toLowerCase()} size="sm" /></td>
                          <td className="py-3 pr-4 text-xs text-surface-500">
                            {latestUpload ? (
                              <div className="flex items-center gap-1.5">
                                <FileCheck2 className="h-3.5 w-3.5 text-success-600" />
                                <div>
                                  <p className="text-surface-700">{latestUpload.originalFileName || "Uploaded file"}</p>
                                  <p>{formatDateTime(latestUpload.createdAt)}</p>
                                  {latestUpload.reviewStatus && <StatusChip status={latestUpload.reviewStatus.toLowerCase()} size="sm" />}
                                </div>
                              </div>
                            ) : "—"}
                            {priorUploads.length > 0 && (
                              <button
                                onClick={() => setExpandedHistory((prev) => ({ ...prev, [r.id]: !prev[r.id] }))}
                                className="mt-1 flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                              >
                                <History className="h-3 w-3" /> {historyOpen ? "Hide" : "View"} {priorUploads.length} prior attempt{priorUploads.length === 1 ? "" : "s"}
                              </button>
                            )}
                          </td>
                          <td className="py-3 pr-6 text-right">
                            <div className="flex justify-end gap-2">
                              {r.status === "PENDING" && (
                                <Button variant="ghost" size="sm" onClick={() => handleCancel(r.id)}>Cancel</Button>
                              )}
                              {r.status === "SUBMITTED" && (
                                <Button variant="secondary" size="sm" onClick={() => handleStartReview(r.id)}>Start Review</Button>
                              )}
                              {(r.status === "SUBMITTED" || r.status === "UNDER_REVIEW") && (
                                <>
                                  <Button size="sm" onClick={() => setReviewModal({ requestId: r.id, decision: "APPROVED" })}>Approve</Button>
                                  <Button variant="ghost" size="sm" onClick={() => setReviewModal({ requestId: r.id, decision: "NEEDS_REPLACEMENT" })}>Needs Replacement</Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                        {historyOpen && priorUploads.length > 0 && (
                          <tr key={`${r.id}-history`}>
                            <td colSpan={6} className="bg-surface-50 px-6 py-3">
                              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-surface-400">Prior Attempts</p>
                              <div className="space-y-1.5">
                                {priorUploads.map((doc) => (
                                  <div key={doc.id} className="flex items-center justify-between text-xs">
                                    <span className="text-surface-700">{doc.originalFileName || "Uploaded file"} · {formatDateTime(doc.createdAt)}</span>
                                    {doc.reviewStatus && <StatusChip status={doc.reviewStatus.toLowerCase()} size="sm" />}
                                  </div>
                                ))}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Request a Document" description="Ask the client's guardian to upload a specific document through the portal." size="lg">
        <form onSubmit={handleCreate} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <Input name="title" label="Title" required placeholder="e.g. Insurance Card (Front & Back)" />
          <Textarea name="description" label="Description (optional)" placeholder="Any additional context for the client" />
          <div className="grid grid-cols-2 gap-4">
            <Select name="category" label="Category" required placeholder="Select a category" options={categoryOptions} />
            <Select name="priority" label="Priority" defaultValue="NORMAL" options={priorityOptions} />
          </div>
          <Input name="dueDate" type="date" label="Due Date (optional)" />
          <Checkbox name="isRequired" label="Required document" defaultChecked />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => setShowCreate(false)}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create Request"}</Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={!!reviewModal}
        onClose={() => { setReviewModal(null); setReviewError(null) }}
        title={reviewModal?.decision === "APPROVED" ? "Approve Document" : "Request Replacement"}
        description={reviewModal?.decision === "APPROVED" ? "Feedback is optional for an approval." : "Feedback is required so the client knows what to fix."}
        size="lg"
      >
        <form onSubmit={handleReviewSubmit} className="space-y-4">
          {reviewError && <Alert variant="error">{reviewError}</Alert>}
          <div className="grid grid-cols-2 gap-4">
            <Select name="category" label="Category" placeholder="Select a category" options={reviewCategoryOptions} required={reviewModal?.decision === "NEEDS_REPLACEMENT"} />
            <Select name="severity" label="Severity" placeholder="Select severity" options={severityOptions} required={reviewModal?.decision === "NEEDS_REPLACEMENT"} />
          </div>
          <Textarea
            name="note"
            label={reviewModal?.decision === "NEEDS_REPLACEMENT" ? "Feedback (required)" : "Feedback (optional)"}
            placeholder="e.g. Front of insurance card missing — please upload both sides."
            required={reviewModal?.decision === "NEEDS_REPLACEMENT"}
          />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => { setReviewModal(null); setReviewError(null) }}>Cancel</Button>
            <Button type="submit" disabled={reviewLoading}>
              {reviewLoading ? "Saving..." : reviewModal?.decision === "APPROVED" ? "Approve" : "Request Replacement"}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
