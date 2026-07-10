"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createDocumentTemplate, createPacketTemplate, getProgramsForOrg } from "@/lib/actions/templates"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Alert } from "@/components/ui/alert"
import { ArrowLeft, Upload, Save, ScrollText, Plus, X } from "lucide-react"
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

  useEffect(() => { getProgramsForOrg(orgId).then(setPrograms) }, [orgId])

  async function handleFormSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true); setError(null)
    const form = new FormData(e.currentTarget)
    const name = form.get("name") as string
    const key = `templates/${name.toLowerCase().replace(/\s+/g, "-")}.pdf`

    const result = await createDocumentTemplate({
      name,
      description: form.get("description") as string,
      formType: form.get("formType") as string,
      program: form.get("program") as string || undefined,
      fileUrl: `https://storage.higsi.com/${key}`,
      fileKey: key,
    })
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
                <p className="text-sm font-medium text-surface-600">Drag & drop PDF file here</p>
                <p className="text-xs text-surface-400 mt-1">or click to browse. PDF files only.</p>
                <input type="file" accept=".pdf" className="hidden" />
                <Button type="button" variant="secondary" size="sm" className="mt-4">Browse Files</Button>
                <p className="mt-2 text-xs text-surface-400">File storage: templates/. PDF storage placeholder until object storage is configured.</p>
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

function PacketTemplateForm({ orgId }: { orgId: string }) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true); setError(null)
    const form = new FormData(e.currentTarget)
    const docIds = form.getAll("documentIds") as string[]

    const result = await createPacketTemplate({
      name: form.get("name") as string,
      description: form.get("description") as string,
      packetType: form.get("packetType") as string,
      programId: form.get("programId") as string || undefined,
      documentIds: docIds,
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
          <p className="text-sm font-medium text-surface-700">Required Documents</p>
          <p className="text-xs text-surface-500">Document selection will be available once templates are created. For now, save the packet template and edit it later.</p>
          <input type="hidden" name="documentIds" value="" />
        </CardContent>
        <CardFooter className="justify-between">
          <Link href="/templates"><Button type="button" variant="secondary"><ArrowLeft className="h-4 w-4" /> Cancel</Button></Link>
          <Button type="submit" loading={loading}><Save className="h-4 w-4" /> Create Template</Button>
        </CardFooter>
      </Card>
    </form>
  )
}
