"use client"

import { useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { createPacket, getPacketTemplates, getProgramsForOrg } from "@/lib/actions/templates"
import { getClients } from "@/lib/actions/client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"
import { Separator } from "@/components/ui/separator"
import { ArrowLeft, Save, FileText, Layers } from "lucide-react"
import Link from "next/link"

interface Props { orgId: string; preselectedClientId?: string }

export function CreatePacketForm({ orgId, preselectedClientId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clients, setClients] = useState<{ id: string; firstName: string; lastName: string }[]>([])
  const [packetTemplates, setPacketTemplates] = useState<Awaited<ReturnType<typeof getPacketTemplates>>>([])
  const [selectedTemplate, setSelectedTemplate] = useState<string>("")
  const [templateDocs, setTemplateDocs] = useState<{ id: string; name: string; required: boolean }[]>([])

  useEffect(() => {
    Promise.all([
      getClients(orgId, { page: 1, pageSize: 100 }).then(r => { setClients(r.clients) }),
      getPacketTemplates(orgId).then(setPacketTemplates),
    ])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-compiler/react-compiler
  }, [orgId])

  useEffect(() => {
    const pt = packetTemplates.find(t => t.id === selectedTemplate)
    if (pt) {
      setTemplateDocs(pt.requiredDocs.map(d => ({ id: d.documentTemplate.id, name: d.documentTemplate.name, required: d.required })))
    } else {
      setTemplateDocs([])
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  // eslint-disable-next-line react-compiler/react-compiler
  }, [selectedTemplate, packetTemplates])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true); setError(null)
    const form = new FormData(e.currentTarget)

    const result = await createPacket({
      clientId: form.get("clientId") as string,
      packetTemplateId: form.get("packetTemplateId") as string,
      dueDate: form.get("dueDate") as string || undefined,
      assignedToId: form.get("assignedToId") as string || undefined,
    })
    if (result.success) { router.push(`/packets/${result.data.id}`); router.refresh() }
    else { setError(result.error); setLoading(false) }
  }

  return (
    <form onSubmit={handleSubmit}>
      <Card>
        <CardHeader>
          <CardTitle>New Packet</CardTitle>
          <CardDescription>Select client and packet template to generate the document checklist</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}

          <Select
            label="Client *"
            name="clientId"
            options={clients.map(c => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))}
            placeholder="Select client"
            defaultValue={preselectedClientId}
            required
          />

          <Select
            label="Packet Template *"
            name="packetTemplateId"
            options={packetTemplates.map(pt => ({ value: pt.id, label: `${pt.name} (${pt.packetType.replace(/_/g, " ")})` }))}
            placeholder="Select template"
            value={selectedTemplate}
            onChange={(e) => setSelectedTemplate(e.target.value)}
            required
          />

          {templateDocs.length > 0 && (
            <div className="rounded-lg border border-surface-200 bg-surface-50 p-4">
              <p className="text-sm font-medium text-surface-700 mb-2">Required Documents ({templateDocs.length})</p>
              <div className="space-y-1">
                {templateDocs.map((doc, i) => (
                  <div key={doc.id} className="flex items-center gap-2 text-sm text-surface-600">
                    <FileText className="h-4 w-4 text-surface-400 shrink-0" />
                    <span>{i + 1}. {doc.name}</span>
                    {doc.required && <span className="text-xs text-danger-500">*</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          <Separator />

          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Due Date" name="dueDate" type="date" hint="Optional deadline for packet completion" />
            <Input label="Assigned To ID" name="assignedToId" placeholder="User ID (optional)" hint="Assign to a specific staff member" />
          </div>
        </CardContent>
        <CardFooter className="justify-between">
          <Link href="/packets"><Button type="button" variant="secondary"><ArrowLeft className="h-4 w-4" /> Cancel</Button></Link>
          <Button type="submit" loading={loading}><Save className="h-4 w-4" /> Create Packet</Button>
        </CardFooter>
      </Card>
    </form>
  )
}
