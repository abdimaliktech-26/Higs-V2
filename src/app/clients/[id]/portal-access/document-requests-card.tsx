"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createPortalDocumentRequest, cancelPortalDocumentRequest } from "@/lib/actions/portal-document-requests"
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
import { EmptyState } from "@/components/ui/states"
import { FilePlus2, FileStack, FileCheck2 } from "lucide-react"
import { formatDate, formatDateTime } from "@/lib/utils"

interface RequestRow {
  id: string
  title: string
  category: string
  priority: string
  isRequired: boolean
  dueDate: string | Date | null
  status: string
  requestedBy: { id: string; name: string | null; email: string }
  supportingDocuments: { id: string; originalFileName: string | null; fileSize: number | null; mimeType: string; createdAt: string | Date }[]
}

interface Props {
  clientId: string
  requests: RequestRow[]
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

export function DocumentRequestsCard({ clientId, requests }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const activeRequests = requests.filter((r) => r.status !== "CANCELLED")

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
                    const latestUpload = r.supportingDocuments[0]
                    return (
                    <tr key={r.id} className="hover:bg-surface-50 transition-colors">
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
                            </div>
                          </div>
                        ) : "—"}
                      </td>
                      <td className="py-3 pr-6 text-right">
                        {r.status === "PENDING" && (
                          <Button variant="ghost" size="sm" onClick={() => handleCancel(r.id)}>Cancel</Button>
                        )}
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

      <Modal open={showCreate} onClose={() => setShowCreate(false)} title="Request a Document" description="Ask the client's guardian to upload a specific document through the portal. Upload itself is coming in a later stage." size="lg">
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
    </>
  )
}
