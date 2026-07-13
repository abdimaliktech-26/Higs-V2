"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { createPortalInvitation, revokePortalInvitation, revokePortalAccess } from "@/lib/actions/portal-invitations"
import { setPortalUploadPermission } from "@/lib/actions/portal-document-requests"
import {
  createPortalAccessAuthorization,
  revokePortalAccessAuthorization,
  setPortalSignPermission,
} from "@/lib/actions/portal-access-authorizations"
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
import { UserPlus, Users, Copy, Check, Loader2, ShieldCheck } from "lucide-react"
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
  canSignDocuments: boolean
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

// Step 5b.1 — Portal Signing Authorization Foundation. Staff-facing only:
// no portal consent-acceptance and no portal signing UI exist anywhere
// here. Staff can never "accept" on the portal user's behalf — acceptedAt
// is not settable from this component at all.
interface AuthorizationRow {
  id: string
  accessGrantId: string
  authorityType: string
  effectiveDate: string | Date
  expirationDate: string | Date | null
  consentText: string
  consentVersion: string
  acceptedAt: string | Date | null
  revokedAt: string | Date | null
  supportingDocument: { id: string; title: string } | null
  grantedBy: { name: string | null; email: string }
}

interface Props {
  orgId: string
  clientId: string
  clientContacts: ClientContact[]
  access: AccessRow[]
  invitations: InvitationRow[]
  authorizations: AuthorizationRow[]
}

const authorityTypeOptions = [
  { value: "SELF", label: "Self" },
  { value: "PARENT_OF_MINOR", label: "Parent of a Minor" },
  { value: "LEGAL_GUARDIAN", label: "Legal Guardian" },
  { value: "POWER_OF_ATTORNEY", label: "Power of Attorney" },
  { value: "CONSERVATOR", label: "Conservator" },
  { value: "ORG_DESIGNATED", label: "Organization-Designated" },
]
const authorityTypeLabels: Record<string, string> = Object.fromEntries(authorityTypeOptions.map((o) => [o.value, o.label]))

type AuthorizationStatus = "NOT_CONFIGURED" | "PENDING_ACCEPTANCE" | "ACCEPTED" | "EXPIRED" | "REVOKED"

function authorizationStatus(auth: AuthorizationRow | undefined, now: Date): AuthorizationStatus {
  if (!auth) return "NOT_CONFIGURED"
  if (auth.revokedAt) return "REVOKED"
  if (auth.expirationDate && new Date(auth.expirationDate) <= now) return "EXPIRED"
  if (!auth.acceptedAt) return "PENDING_ACCEPTANCE"
  return "ACCEPTED"
}

const authorizationStatusLabels: Record<AuthorizationStatus, string> = {
  NOT_CONFIGURED: "Not configured",
  PENDING_ACCEPTANCE: "Pending portal acceptance",
  ACCEPTED: "Accepted",
  EXPIRED: "Expired",
  REVOKED: "Revoked",
}
const authorizationStatusVariant: Record<AuthorizationStatus, "outline" | "warning" | "success" | "danger"> = {
  NOT_CONFIGURED: "outline",
  PENDING_ACCEPTANCE: "warning",
  ACCEPTED: "success",
  EXPIRED: "danger",
  REVOKED: "danger",
}

const accessRoleOptions = [
  { value: "GUARDIAN", label: "Guardian" },
  { value: "PARENT", label: "Parent" },
  { value: "RESPONSIBLE_PARTY", label: "Responsible Party" },
  { value: "AUTHORIZED_REPRESENTATIVE", label: "Authorized Representative" },
  { value: "CLIENT_SELF", label: "Client (self)" },
]
const accessRoleLabels: Record<string, string> = Object.fromEntries(accessRoleOptions.map((o) => [o.value, o.label]))

export function ClientPortalAccessManager({ clientId, clientContacts, access, invitations, authorizations }: Props) {
  const router = useRouter()
  const [showCreate, setShowCreate] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newLink, setNewLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // Step 5b.1 — authorization foundation UI state. showAuthGrantId is the
  // access grant currently being configured (opens the create-authorization
  // modal); reviewAuth is the authorization currently being reviewed
  // read-only. Neither modal ever exposes an "accept" control — acceptance
  // is exclusively a future portal-user action.
  const [showAuthGrantId, setShowAuthGrantId] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)
  const [authError, setAuthError] = useState<string | null>(null)
  const [reviewAuth, setReviewAuth] = useState<AuthorizationRow | null>(null)

  const pendingInvitations = invitations.filter((i) => i.displayStatus === "PENDING")

  // Authorizations are already ordered newest-first by the server — the
  // first match per grant is the current one; any earlier rows for the
  // same grant are superseded history, not hidden, just not the "current"
  // one this UI surfaces for review/enablement.
  function currentAuthorizationForGrant(accessGrantId: string): AuthorizationRow | undefined {
    return authorizations.find((a) => a.accessGrantId === accessGrantId)
  }

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

  async function handleCreateAuthorization(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!showAuthGrantId) return
    setAuthLoading(true)
    setAuthError(null)

    const form = new FormData(e.currentTarget)
    const data = {
      accessGrantId: showAuthGrantId,
      authorityType: form.get("authorityType") as string,
      consentText: form.get("consentText") as string,
      consentVersion: form.get("consentVersion") as string,
      effectiveDate: form.get("effectiveDate") as string,
      expirationDate: (form.get("expirationDate") as string) || undefined,
      supportingDocumentId: (form.get("supportingDocumentId") as string) || undefined,
    }

    const result = await createPortalAccessAuthorization(data)
    setAuthLoading(false)
    if (result.success) {
      setShowAuthGrantId(null)
      router.refresh()
    } else {
      setAuthError(result.error)
    }
  }

  async function handleRevokeAuthorization(authorizationId: string) {
    if (!confirm("Revoke this signing authorization? This immediately disables signing for the linked access grant and cannot be undone — a new authorization would need to be created to grant authority again.")) return
    const result = await revokePortalAccessAuthorization(authorizationId)
    if (!result.success) alert(result.error)
    router.refresh()
  }

  async function handleToggleSignPermission(accessGrantId: string, enabled: boolean) {
    const result = await setPortalSignPermission(accessGrantId, enabled)
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

      {access.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Signing Authorizations</CardTitle>
            <p className="mt-1 text-xs text-surface-500">
              Staff-verified legal authority to sign electronically, required before signing can be enabled for a portal user. Production consent wording and evidence requirements must be reviewed by legal/compliance before relying on this in production.
            </p>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Portal User</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Authorization Status</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Authority Type</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Effective / Expires</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Signing</th>
                    <th className="pb-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {access.map((a) => {
                    const auth = currentAuthorizationForGrant(a.id)
                    const status = authorizationStatus(auth, new Date())
                    const canEnable = status === "ACCEPTED" && a.status === "ACTIVE"
                    return (
                      <tr key={a.id} className="hover:bg-surface-50 transition-colors">
                        <td className="py-3 pl-6 pr-4 font-medium text-surface-900">{a.portalUser.email}</td>
                        <td className="py-3 pr-4">
                          <Badge variant={authorizationStatusVariant[status]} size="sm">{authorizationStatusLabels[status]}</Badge>
                        </td>
                        <td className="py-3 pr-4 text-surface-700">{auth ? (authorityTypeLabels[auth.authorityType] || auth.authorityType) : "—"}</td>
                        <td className="py-3 pr-4 text-xs text-surface-500">
                          {auth ? (
                            <>
                              {formatDate(auth.effectiveDate)}
                              {auth.expirationDate ? ` – ${formatDate(auth.expirationDate)}` : " – No expiration"}
                            </>
                          ) : "—"}
                        </td>
                        <td className="py-3 pr-4">
                          {a.status === "ACTIVE" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={!a.canSignDocuments && !canEnable}
                              title={!a.canSignDocuments && !canEnable ? "Requires an accepted, effective authorization" : undefined}
                              onClick={() => handleToggleSignPermission(a.id, !a.canSignDocuments)}
                            >
                              {a.canSignDocuments ? "Enabled" : "Disabled"}
                            </Button>
                          ) : (
                            <span className="text-xs text-surface-400">{a.canSignDocuments ? "Enabled" : "Disabled"}</span>
                          )}
                        </td>
                        <td className="py-3 pr-6 text-right space-x-2 whitespace-nowrap">
                          {auth ? (
                            <>
                              <Button variant="ghost" size="sm" onClick={() => setReviewAuth(auth)}>Review</Button>
                              {status !== "REVOKED" && (
                                <Button variant="ghost" size="sm" onClick={() => handleRevokeAuthorization(auth.id)}>Revoke</Button>
                              )}
                              {status === "REVOKED" && (
                                <Button variant="ghost" size="sm" onClick={() => setShowAuthGrantId(a.id)}>New Authorization</Button>
                              )}
                            </>
                          ) : (
                            <Button variant="secondary" size="sm" onClick={() => setShowAuthGrantId(a.id)}>
                              <ShieldCheck className="h-4 w-4" /> Create Authorization
                            </Button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

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

      <Modal
        open={showAuthGrantId !== null}
        onClose={() => { setShowAuthGrantId(null); setAuthError(null) }}
        title="Create Signing Authorization"
        description="Staff-verified record of legal authority to sign electronically. This does not grant signing permission by itself — the portal user must still accept it, and staff must separately enable signing."
        size="lg"
      >
        <form onSubmit={handleCreateAuthorization} className="space-y-4">
          {authError && <Alert variant="error">{authError}</Alert>}
          <Alert variant="warning">
            Consent text and version must reflect your organization&apos;s reviewed, production-ready wording. Evidence requirements per authority type must be defined by legal/compliance before relying on this in production.
          </Alert>
          <Select name="authorityType" label="Authority Type" required placeholder="Select authority type" options={authorityTypeOptions} />
          <Textarea name="consentText" label="Consent Text" required placeholder="The reviewed consent/authorization text presented to the portal user for acceptance." rows={5} />
          <Input name="consentVersion" label="Consent Version" required placeholder="e.g. v1" />
          <div className="grid grid-cols-2 gap-4">
            <Input name="effectiveDate" type="date" label="Effective Date" required />
            <Input name="expirationDate" type="date" label="Expiration Date (optional)" />
          </div>
          <Input name="supportingDocumentId" label="Supporting Document ID (optional)" placeholder="ID of a supporting document already on file for this client" />
          <div className="flex justify-end gap-3 pt-2">
            <Button type="button" variant="ghost" onClick={() => { setShowAuthGrantId(null); setAuthError(null) }}>Cancel</Button>
            <Button type="submit" disabled={authLoading}>
              {authLoading ? <><Loader2 className="h-4 w-4 animate-spin" /> Creating...</> : "Create Authorization"}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal
        open={reviewAuth !== null}
        onClose={() => setReviewAuth(null)}
        title="Signing Authorization"
        description="Read-only record. Staff cannot accept this on the portal user's behalf — acceptance is a portal-user action in a later step."
        size="lg"
      >
        {reviewAuth && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Authority Type</p>
                <p className="text-surface-900">{authorityTypeLabels[reviewAuth.authorityType] || reviewAuth.authorityType}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Consent Version</p>
                <p className="text-surface-900">{reviewAuth.consentVersion}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Effective Date</p>
                <p className="text-surface-900">{formatDate(reviewAuth.effectiveDate)}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Expiration Date</p>
                <p className="text-surface-900">{reviewAuth.expirationDate ? formatDate(reviewAuth.expirationDate) : "No expiration"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Verified By</p>
                <p className="text-surface-900">{reviewAuth.grantedBy.name || reviewAuth.grantedBy.email}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Supporting Document</p>
                <p className="text-surface-900">{reviewAuth.supportingDocument?.title || "None"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Portal Acceptance</p>
                <p className="text-surface-900">{reviewAuth.acceptedAt ? formatDate(reviewAuth.acceptedAt) : "Not yet accepted"}</p>
              </div>
              <div>
                <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Revoked</p>
                <p className="text-surface-900">{reviewAuth.revokedAt ? formatDate(reviewAuth.revokedAt) : "No"}</p>
              </div>
            </div>
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-surface-500">Consent Text</p>
              <p className="mt-1 whitespace-pre-wrap rounded-lg border border-surface-200 bg-surface-50 p-3 text-surface-700">{reviewAuth.consentText}</p>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => setReviewAuth(null)}>Close</Button>
            </div>
          </div>
        )}
      </Modal>
    </>
  )
}
