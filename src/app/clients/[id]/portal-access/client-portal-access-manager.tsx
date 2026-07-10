"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createPortalInvitation, revokePortalInvitation, revokePortalAccess } from "@/lib/actions/portal-invitations"
import { setPortalUploadPermission } from "@/lib/actions/portal-document-requests"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Checkbox } from "@/components/ui/checkbox"
import { Badge } from "@/components/ui/badge"
import { StatusChip } from "@/components/ui/status-chip"
import { Modal } from "@/components/ui/modal"
import { Alert } from "@/components/ui/alert"
import { EmptyState } from "@/components/ui/states"
import { UserPlus, Users, Copy, Check, Loader2 } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface ClientContact { id: string; firstName: string; lastName: string; email: string | null; relationship: string; isGuardian: boolean }
interface AccessRow {
  id: string
  relationship: string
  accessRole: string
  status: string
  canViewDocuments: boolean
  canViewAppointments: boolean
  canMessageCareTeam: boolean
  canUploadDocuments: boolean
  expiresAt: string | Date | null
  portalUser: { id: string; email: string; status: string; lastLoginAt: string | Date | null }
}
interface InvitationRow {
  id: string
  invitedEmail: string
  relationship: string | null
  accessRole: string
  displayStatus: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"
  expiresAt: string | Date
}

interface Props {
  orgId: string
  clientId: string
  clientContacts: ClientContact[]
  access: AccessRow[]
  invitations: InvitationRow[]
}

const accessRoleOptions = [
  { value: "GUARDIAN", label: "Guardian" },
  { value: "PARENT", label: "Parent" },
  { value: "RESPONSIBLE_PARTY", label: "Responsible Party" },
  { value: "AUTHORIZED_REPRESENTATIVE", label: "Authorized Representative" },
  { value: "CLIENT_SELF", label: "Client (self)" },
]
const accessRoleLabels: Record<string, string> = Object.fromEntries(accessRoleOptions.map((o) => [o.value, o.label]))

export function ClientPortalAccessManager({ clientId, clientContacts, access, invitations }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const pendingInvitations = invitations.filter((i) => i.displayStatus === "PENDING")

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = new FormData(e.currentTarget)
    const data = {
      clientId,
      invitedEmail: form.get("invitedEmail") as string,
      relationship: form.get("relationship") as string,
      accessRole: form.get("accessRole") as string,
      canViewDocuments: form.get("canViewDocuments") === "on",
      canViewAppointments: form.get("canViewAppointments") === "on",
      canMessageCareTeam: form.get("canMessageCareTeam") === "on",
    }

    const result = await createPortalInvitation(data)
    setLoading(false)
    if (result.success) {
      const origin = typeof window !== "undefined" ? window.location.origin : ""
      setNewLink(`${origin}/portal/invite/${result.data.rawToken}`)
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  async function handleRevokeInvitation(invitationId: string) {
    if (!confirm("Revoke this invitation?")) return
    const result = await revokePortalInvitation(invitationId)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  async function handleRevokeAccess(accessId: string) {
    if (!confirm("Revoke this person's portal access to this client?")) return
    const result = await revokePortalAccess(accessId)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  async function handleToggleUpload(accessId: string, enabled: boolean) {
    const result = await setPortalUploadPermission(accessId, enabled)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  function closeCreate() {
    setShowCreate(false)
    setNewLink(null)
    setCopied(false)
    setError(null)
  }

  function copyLink() {
    if (!newLink) return
    navigator.clipboard.writeText(newLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setShowCreate(true)}><UserPlus className="h-4 w-4" /> Invite to Portal</Button>
      </div>

      <Card>
        <CardHeader><CardTitle>Active Portal Access</CardTitle></CardHeader>
        <CardContent className="p-0">
          {access.length === 0 ? (
            <div className="px-6 pb-6">
              <EmptyState title="No portal users yet" description="No one has activated portal access for this client." icon={<Users className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Portal User</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Relationship / Role</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Permissions</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Uploads</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                    <th className="pb-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {access.map((a) => (
                    <tr key={a.id} className="hover:bg-surface-50 transition-colors">
                      <td className="py-3 pl-6 pr-4 font-medium text-surface-900">{a.portalUser.email}</td>
                      <td className="py-3 pr-4">
                        <div className="text-surface-900">{a.relationship}</div>
                        <Badge variant="outline" size="sm">{accessRoleLabels[a.accessRole] || a.accessRole}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs text-surface-500">
                        {[a.canViewDocuments && "View Documents", a.canViewAppointments && "View Appointments", a.canMessageCareTeam && "Message Care Team"].filter(Boolean).join(", ") || "None"}
                      </td>
                      <td className="py-3 pr-4">
                        {a.status === "ACTIVE" ? (
                          <Button variant="ghost" size="sm" onClick={() => handleToggleUpload(a.id, !a.canUploadDocuments)}>
                            {a.canUploadDocuments ? "Enabled" : "Disabled"}
                          </Button>
                        ) : (
                          <span className="text-xs text-surface-400">{a.canUploadDocuments ? "Enabled" : "Disabled"}</span>
                        )}
                      </td>
                      <td className="py-3 pr-4"><StatusChip status={a.status.toLowerCase()} size="sm" /></td>
                      <td className="py-3 pr-6 text-right">
                        {a.status === "ACTIVE" && (
                          <Button variant="ghost" size="sm" onClick={() => handleRevokeAccess(a.id)}>Revoke</Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {pendingInvitations.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Pending Invitations</CardTitle></CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Invited Email</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Relationship / Role</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Expires</th>
                    <th className="pb-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {pendingInvitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-50 transition-colors">
                      <td className="py-3 pl-6 pr-4 text-surface-900">{inv.invitedEmail}</td>
                      <td className="py-3 pr-4">
                        <div className="text-surface-900">{inv.relationship || "—"}</div>
                        <Badge variant="outline" size="sm">{accessRoleLabels[inv.accessRole] || inv.accessRole}</Badge>
                      </td>
                      <td className="py-3 pr-4 text-xs text-surface-500">{formatDate(inv.expiresAt)}</td>
                      <td className="py-3 pr-6 text-right">
                        <Button variant="ghost" size="sm" onClick={() => handleRevokeInvitation(inv.id)}>Revoke</Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      <Modal
        open={showCreate}
        onClose={closeCreate}
        title={newLink ? "Invitation Created" : "Invite to Portal"}
        description={newLink ? "Share this link with the invited person. It will only be shown once." : "Real email delivery is Coming Soon — copy the link below and share it securely with the invited person."}
        size="lg"
      >
        {newLink ? (
          <div className="space-y-4">
            <Alert variant="warning">This link grants portal access setup for this client. Treat it like a password — share it only through a secure channel.</Alert>
            <div className="flex items-center gap-2 rounded-lg border border-surface-200 bg-surface-50 p-3">
              <code className="flex-1 truncate text-xs text-surface-700">{newLink}</code>
              <Button type="button" size="sm" variant="secondary" onClick={copyLink}>
                {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy Link</>}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button onClick={closeCreate}>Done</Button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleCreate} className="space-y-4">
            {error && <Alert variant="error">{error}</Alert>}
            {clientContacts.length > 0 && (
              <Select
                label="Prefill from existing contact"
                placeholder="Select a contact (optional)"
                options={clientContacts.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName} (${c.relationship})` }))}
                onChange={(e) => {
                  const contact = clientContacts.find((c) => c.id === e.target.value)
                  const emailInput = document.querySelector<HTMLInputElement>('input[name="invitedEmail"]')
                  const relInput = document.querySelector<HTMLInputElement>('input[name="relationship"]')
                  if (contact && emailInput) emailInput.value = contact.email || ""
                  if (contact && relInput) relInput.value = contact.relationship || ""
                }}
              />
            )}
            <Input name="invitedEmail" type="email" label="Invited Email" required placeholder="guardian@example.com" />
            <Input name="relationship" label="Relationship" required placeholder="e.g. Mother, Legal Guardian" />
            <Select name="accessRole" label="Access Role" required placeholder="Select a role" options={accessRoleOptions} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-surface-700">Requested Permissions</p>
              <p className="text-xs text-surface-500">Document upload can be enabled separately once this person&apos;s account is active. E-signature and guardian-management permissions remain unavailable until a legal-authority verification workflow exists.</p>
              <Checkbox name="canViewDocuments" label="View portal-visible documents" />
              <Checkbox name="canViewAppointments" label="View appointments" />
              <Checkbox name="canMessageCareTeam" label="Message care team" />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <Button type="button" variant="ghost" onClick={closeCreate}>Cancel</Button>
              <Button type="submit" disabled={loading}>
                {loading ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : "Create Invitation"}
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </>
  )
}
