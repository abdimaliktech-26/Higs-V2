"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createSignatureRequest } from "@/lib/actions/signatures"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select } from "@/components/ui/select"
import { RadioGroup } from "@/components/ui/checkbox"
import { Modal } from "@/components/ui/modal"
import { Alert } from "@/components/ui/alert"
import { User } from "lucide-react"

export interface EligibleSignatureField {
  id: string
  packetDocumentId: string
  name: string
  pageNumber: number
  isRequired: boolean
  documentName: string
}

export interface EligiblePortalSigningGrant {
  accessGrantId: string
  portalUserId: string
  email: string
  contactName: string
  relationship: string
  accessRole: string
}

interface Props {
  packetId: string
  defaultSignerName: string
  defaultSignerEmail: string
  eligibleFields: EligibleSignatureField[]
  eligibleGrants: EligiblePortalSigningGrant[]
}

// Step 5c.1 — the only staff-facing creation surface for a signature
// request. Staff always deliberately selects a field (never auto-selected
// except when exactly one is eligible, which the native <select>'s own
// single-option behavior already handles with no special-case code) and,
// for a portal-assigned request, a portal access grant — never a free-typed
// portal-user id, email, or contact. Every other portal-signer field
// (name, email, role) is server-derived by createSignatureRequest itself
// from the selected grant; nothing about it is editable here.
export function RequestSignatureModal({ packetId, defaultSignerName, defaultSignerEmail, eligibleFields, eligibleGrants }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [assignmentType, setAssignmentType] = useState<"STAFF" | "PORTAL">("STAFF")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  function close() {
    setOpen(false)
    setError(null)
    setAssignmentType("STAFF")
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = new FormData(e.currentTarget)
    const [packetDocumentId, pdfFieldId] = ((form.get("field") as string) || "").split("::")
    const base = {
      packetId,
      packetDocumentId,
      pdfFieldId,
      consentText: form.get("consentText") as string,
      dueDate: (form.get("dueDate") as string) || undefined,
      notes: (form.get("notes") as string) || undefined,
    }

    const payload =
      assignmentType === "PORTAL"
        ? { assignmentType: "PORTAL" as const, ...base, accessGrantId: form.get("accessGrantId") as string }
        : {
            assignmentType: "STAFF" as const,
            ...base,
            signerName: form.get("signerName") as string,
            signerEmail: form.get("signerEmail") as string,
            signerRole: form.get("signerRole") as string,
            signerType: form.get("signerType") as string,
          }

    const result = await createSignatureRequest(payload)
    setLoading(false)
    if (result.success) {
      close()
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  if (eligibleFields.length === 0) {
    return (
      <Button
        type="button"
        className="w-full justify-start"
        variant="secondary"
        disabled
        title="No eligible signature fields are available on this packet's active documents."
      >
        <User className="h-4 w-4" /> Request Signature
      </Button>
    )
  }

  return (
    <>
      <Button type="button" className="w-full justify-start" variant="secondary" onClick={() => setOpen(true)}>
        <User className="h-4 w-4" /> Request Signature
      </Button>

      <Modal open={open} onClose={close} title="Request Signature" description="Every request must link to a specific signature field and carry the consent text the signer will see." size="lg">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div role="alert">
              <Alert variant="error">{error}</Alert>
            </div>
          )}

          {eligibleGrants.length > 0 ? (
            <RadioGroup
              name="assignmentTypeChoice"
              value={assignmentType}
              onChange={(v) => setAssignmentType(v as "STAFF" | "PORTAL")}
              options={[
                { value: "STAFF", label: "Staff / external signer" },
                { value: "PORTAL", label: "Portal user" },
              ]}
            />
          ) : (
            <p className="text-xs text-surface-500">
              No portal signers are currently eligible for this client — a portal user needs an active, accepted signing authorization with signing permission enabled before they can be assigned a request here.
            </p>
          )}

          <Select
            name="field"
            label="Document & Signature Field"
            required
            placeholder={eligibleFields.length > 1 ? "Select a signature field" : undefined}
            defaultValue={eligibleFields.length === 1 ? `${eligibleFields[0].packetDocumentId}::${eligibleFields[0].id}` : undefined}
            options={eligibleFields.map((f) => ({
              value: `${f.packetDocumentId}::${f.id}`,
              label: `${f.documentName} — ${f.name} (p.${f.pageNumber})${f.isRequired ? "" : " · optional"}`,
            }))}
          />

          {assignmentType === "PORTAL" ? (
            <Select
              name="accessGrantId"
              label="Portal Signer"
              required
              placeholder={eligibleGrants.length > 1 ? "Select a portal signer" : undefined}
              defaultValue={eligibleGrants.length === 1 ? eligibleGrants[0].accessGrantId : undefined}
              options={eligibleGrants.map((g) => ({
                value: g.accessGrantId,
                label: `${g.contactName} (${g.relationship}) — ${g.email}`,
              }))}
            />
          ) : (
            <>
              <Input name="signerName" label="Signer Name" required defaultValue={defaultSignerName} />
              <Input name="signerEmail" type="email" label="Signer Email" required defaultValue={defaultSignerEmail} />
              <Input name="signerRole" label="Signer Role" required defaultValue="Client" />
              <Input name="signerType" label="Signer Type" required defaultValue="client" />
            </>
          )}

          <Textarea name="consentText" label="Consent Text" required placeholder="The reviewed consent statement this signer must accept before signing." rows={4} />
          <Input name="dueDate" type="date" label="Due Date (optional)" />

          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={loading}>{loading ? "Creating..." : "Create Request"}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
