"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { createPacketTemplate, getProgramsForOrg, getDocumentTemplates } from "@/lib/actions/templates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/states"
import { ArrowLeft, Upload, Save, FileText } from "lucide-react"
import Link from "next/link"
import { Tabs } from "@/components/ui/tabs"

interface Props { orgId: string; initialTab?: "form" | "packet" }

const formTypes = [
  { value: "dhs", label: "DHS Form" },
  { value: "medical", label: "Medical Form" },
  { value: "progress", label: "Progress Note" },
  { value: "incident", label: "Incident Report" },
  { value: "consent", label: "Consent Form" },
  { value: "assessment", label: "Assessment Tool" },
  { value: "other", label: "Other" },
]

const packetTypeOptions = [
  { value: "initial_intake", label: "Initial Intake" },
  { value: "annual_review", label: "Annual Review" },
  { value: "semiannual_review", label: "Semiannual Review" },
  { value: "change_of_status", label: "Change of Status" },
  { value: "45_day", label: "45-Day Review" },
]

export function UploadFormContent({ orgId, initialTab = "form" }: Props) {
  const router = useRouter()
  const [tab, setTab] = useState(initialTab)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [programs, setPrograms] = useState<{ id: string; name: string; code: string }[]>([])
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { getProgramsForOrg(orgId).then(setPrograms) }, [orgId])

  async function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) { setError("Select a PDF file to upload"); return }
    setLoading(true); setError(null)
    const form = new FormData(e.currentTarget)
    form.set("file", file)

    const res = await fetch("/api/templates", { method: "POST", body: form })
    const result = await res.json()
    if (result.success) { router.push("/templates"); router.refresh() }
    else { setError(result.error); setLoading(false) }
  }

  return (
    <div>
      <Tabs
        tabs={[
          { value: "form", label: "Upload Form" },
          { value: "packet", label: "Packet Template" }
        ]}
        value={tab}
        onChange={(v) => setTab(v as "form" | "packet")}
        className="mb-6"
      />

      {tab === "form" ? (
        <form onSubmit={handleFormSubmit}>
          <Card>
            <CardHeader>
              <CardTitle>Upload Document Template</CardTitle>
              <CardDescription>Add a DHS PDF form or other document template to the system</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && <Alert variant="error">{error}</Alert>}
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Form Name *" name="name" placeholder="e.g. CSSP Addendum" required />
                <Select label="Form Type" name="formType" options={formTypes} placeholder="Select type" />
              </div>
              <Textarea label="Description" name="description" placeholder="Brief description of this form" rows={2} />
              <Select label="Program" name="program" options={programs.map(p => ({ value: p.code || p.id, label: p.name }))} placeholder="All programs (leave blank)" />
              <div className="rounded-lg border-2 border-dashed border-surface-300 p-8 text-center">
                <Upload className="mx-auto mb-2 h-8 w-8 text-surface-400" />
                <p className="text-sm font-medium text-surface-600">{file ? file.name : "Choose a PDF file"}</p>
                <p className="text-xs text-surface-400 mt-1">PDF only, up to 25 MB. Validated and stored securely on upload.</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,application/pdf"
                  className="hidden"
                  onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                />
                <Button type="button" variant="secondary" size="sm" className="mt-4" onClick={() => fileInputRef.current?.click()}>
                  Browse Files
                </Button>
              </div>
            </CardContent>
            <CardFooter className="justify-between">
              <Link href="/templates"><Button type="button" variant="secondary"><ArrowLeft className="h-4 w-4" /> Cancel</Button></Link>
              <Button type="submit" loading={loading}><Upload className="h-4 w-4" /> Upload Template</Button>
            </CardFooter>
          </Card>
        </form>
      ) : (
        <PacketTemplateForm orgId={orgId} />
      )}
    </div>
  )
}

interface PickableDocument { id: string; name: string; formType: string; status: string }

function PacketTemplateForm({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [documents, setDocuments] = useState<PickableDocument[]>([])
  // Map of documentTemplateId -> required flag; presence in the map means selected.
  const [picks, setPicks] = useState<Map<string, boolean>>(new Map())

  useEffect(() => {
    getDocumentTemplates(orgId, { status: "active" }).then((templates) =>
      setDocuments(templates.map((t) => ({ id: t.id, name: t.name, formType: t.formType, status: t.status })))
    )
  }, [orgId])

  function toggleSelected(id: string) {
    setPicks((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.delete(id)
      else next.set(id, true)
      return next
    })
  }

  function toggleRequired(id: string) {
    setPicks((prev) => {
      const next = new Map(prev)
      if (next.has(id)) next.set(id, !next.get(id))
      return next
    })
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true); setError(null)
    const form = new FormData(e.currentTarget)

    const result = await createPacketTemplate({
      name: form.get("name") as string,
      description: form.get("description") as string,
      packetType: form.get("packetType") as string,
      programId: form.get("programId") as string || undefined,
      documents: Array.from(picks.entries()).map(([documentTemplateId, required]) => ({ documentTemplateId, required })),
    })
    if (result.success) { router.push("/templates"); router.refresh() }
    else { setError(result.error); setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>Create Packet Template</CardTitle>
          <CardDescription>Define which documents are required for each packet type</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Template Name *" name="name" placeholder="e.g. Initial Intake Packet" required />
            <Select label="Packet Type" name="packetType" options={packetTypeOptions} placeholder="Select type" />
          </div>
          <Textarea label="Description" name="description" placeholder="Describe this packet template" rows={2} />
          <div>
            <p className="text-sm font-medium text-surface-700">Documents</p>
            <p className="text-xs text-surface-500">Select which active document templates belong in this packet, and mark each as required or optional.</p>
            {documents.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="No active document templates" description="Upload and activate a document template first." icon={<FileText className="h-6 w-6" />} />
              </div>
            ) : (
              <div className="mt-3 space-y-2 rounded-lg border border-surface-200 p-3">
                {documents.map((doc) => {
                  const required = picks.get(doc.id)
                  const selected = picks.has(doc.id)
                  return (
                    <div key={doc.id} className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 hover:bg-surface-50">
                      <Checkbox
                        label={doc.name}
                        checked={selected}
                        onChange={() => toggleSelected(doc.id)}
                      />
                      <Checkbox
                        label="Required"
                        checked={selected ? required : false}
                        disabled={!selected}
                        onChange={() => toggleRequired(doc.id)}
                      />
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <Link href="/templates"><Button type="button" variant="secondary"><ArrowLeft className="h-4 w-4" /> Cancel</Button></Link>
          <Button type="submit" loading={loading}><Save className="h-4 w-4" /> Create Template</Button>
        </CardFooter>
      </Card>
    </form>
  )
}
