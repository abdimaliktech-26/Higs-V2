"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Alert } from "@/components/ui/alert"
import { Upload } from "lucide-react"
import { waitForSupportingDocumentUpload } from "@/lib/uploads/supporting-upload-client"

const SUPPORTING_CATEGORIES = [
  { value: "assessment", label: "Assessment" },
  { value: "report", label: "Report" },
  { value: "correspondence", label: "Correspondence" },
  { value: "supporting", label: "Other Supporting Document" },
]

export function SupportingUploadForm() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    const formElement = e.currentTarget
    const form = new FormData(formElement)
    const file = form.get("file")
    if (!(file instanceof File) || file.size === 0) {
      setError("Choose a file to upload.")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/supporting-documents", {
        method: "POST",
        body: form,
        headers: { "Idempotency-Key": crypto.randomUUID() },
      })
      const result = await res.json()
      if (!result.success) {
        setError(result.error)
        setLoading(false)
        return
      }
      if (result.data.status !== "COMPLETED") await waitForSupportingDocumentUpload(result.data.attemptId)
      formElement.reset()
      router.refresh()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload processing failed")
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card id="upload">
      <CardHeader>
        <div className="flex items-center gap-2">
          <Upload className="h-5 w-5 text-surface-400" />
          <CardTitle>Upload Supporting Document</CardTitle>
        </div>
        <CardDescription>Assessments, reports, and other records that aren&apos;t part of a DHS packet form</CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="grid gap-3 sm:grid-cols-2">
          {error && <div className="sm:col-span-2"><Alert variant="error">{error}</Alert></div>}
          <Input name="title" placeholder="Document title" required />
          <Select name="category" defaultValue="supporting" options={SUPPORTING_CATEGORIES} />
          <Input name="description" placeholder="Description (optional)" className="sm:col-span-2" />
          <input type="file" name="file" required className="sm:col-span-2 text-sm text-surface-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100" />
          <div className="sm:col-span-2">
            <Button type="submit" disabled={loading}>
              <Upload className="h-4 w-4" /> {loading ? "Securely processing…" : "Upload Document"}
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
