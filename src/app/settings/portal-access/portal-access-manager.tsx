"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createPortalInvitation, revokePortalInvitation } from "@/lib/actions/portal-invitations"
import { Card, CardContent } from "@/components/ui/card"
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

interface ClientOption {
  id: string
  firstName: string
  lastName: string
  contacts: { id: string; firstName: string; lastName: string; email: string | null; relationship: string }[]
}

interface InvitationRow {
  id: string
  invitedEmail: string
  relationship: string | null
  accessRole: string
  displayStatus: "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"
  expiresAt: string | Date
  createdAt: string | Date
  client: { id: string; firstName: string; lastName: string }
  invitedBy: { id: string; name: string | null; email: string }
}

interface Props {
  orgId: string
  invitations: InvitationRow[]
  clients: ClientOption[]
}

const accessRoleOptions = [
  { value: "GUARDIAN", label: "Guardian" },
  { value: "PARENT", label: "Parent" },
  { value: "RESPONSIBLE_PARTY", label: "Responsible Party" },
  { value: "AUTHORIZED_REPRESENTATIVE", label: "Authorized Representative" },
  { value: "CLIENT_SELF", label: "Client (self)" },
]

const accessRoleLabels: Record<string, string> = Object.fromEntries(accessRoleOptions.map((o) => [o.value, o.label]))

export function PortalAccessManager({ orgId, invitations, clients }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    const form = new FormData(e.currentTarget)
    const data = {
      clientId: form.get("clientId") as string,
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

  async function handleRevoke(invitationId: string) {
    if (!confirm("Revoke this invitation? The link will stop working immediately.")) return
    const result = await revokePortalInvitation(invitationId)
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-surface-500">{invitations.length} invitation{invitations.length !== 1 ? "s" : ""}</p>
        <Button onClick={() => setShowCreate(true)}><UserPlus className="h-4 w-4" /> New Invitation</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {invitations.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState title="No portal invitations yet" description="Invite a client's guardian or authorized representative to the portal." icon={<Users className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Client</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Invited Email</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Relationship / Role</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Expires</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Invited By</th>
                    <th className="pb-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {invitations.map((inv) => (
                    <tr key={inv.id} className="hover:bg-surface-50 transition-colors">
                      <td className="py-3 pl-6 pr-4 font-medium text-surface-900">{inv.client.firstName} {inv.client.lastName}</td>
                      <td className="py-3 pr-4 text-surface-600">{inv.invitedEmail}</td>
                      <td className="py-3 pr-4">
                        <div className="text-surface-900">{inv.relationship || "—"}</div>
                        <Badge variant="outline" size="sm">{accessRoleLabels[inv.accessRole] || inv.accessRole}</Badge>
                      </td>
                      <td className="py-3 pr-4"><StatusChip status={inv.displayStatus.toLowerCase()} size="sm" /></td>
                      <td className="py-3 pr-4 text-xs text-surface-500">{formatDate(inv.expiresAt)}</td>
                      <td className="py-3 pr-4 text-xs text-surface-500">{inv.invitedBy.name || inv.invitedBy.email}</td>
                      <td className="py-3 pr-6 text-right">
                        {inv.displayStatus === "PENDING" && (
                          <Button variant="ghost" size="sm" onClick={() => handleRevoke(inv.id)}>Revoke</Button>
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

      <Modal
        open={showCreate}
        onClose={closeCreate}
        title={newLink ? "Invitation Created" : "New Portal Invitation"}
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
            <Select name="clientId" label="Client" required placeholder="Select a client"
              options={clients.map((c) => ({ value: c.id, label: `${c.firstName} ${c.lastName}` }))} />
            <Input name="invitedEmail" type="email" label="Invited Email" required placeholder="guardian@example.com" />
            <Input name="relationship" label="Relationship" required placeholder="e.g. Mother, Legal Guardian" />
            <Select name="accessRole" label="Access Role" required placeholder="Select a role" options={accessRoleOptions} />
            <div className="space-y-2">
              <p className="text-sm font-medium text-surface-700">Requested Permissions</p>
              <p className="text-xs text-surface-500">Document upload, e-signature, and guardian-management permissions are not available until a legal-authority verification workflow exists.</p>
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
