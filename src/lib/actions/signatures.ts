"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { validate, createSignatureRequestSchema } from "@/lib/validation"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { requirePortalPermission, requirePortalClientAccess } from "@/lib/portal/auth"
import { createAuditEvent, createPortalAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import type { Prisma } from "@prisma/client"
import { limiters, checkRateLimit } from "@/lib/rate-limit"
import { formatSignedFieldValue, normalizeSignerName, normalizeDisplayName } from "@/lib/actions/signature-formatting"

const REQUEST_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

// Step 5a.1 — the only approved role set for actually executing (not just
// requesting) a signature. Reuses REQUEST_ROLES' exact membership per the
// approved decision rather than inventing a narrower set without evidence
// one is needed.
const EXECUTION_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

// Statuses updateSignatureStatus (the generic, non-execution status action)
// may still set. "signed" is deliberately excluded at both the TypeScript
// and zod level — executeStaffSignature is the only path to "signed" as of
// Step 5a.1.
const NON_SIGNING_STATUSES = ["pending", "sent", "viewed", "declined", "cancelled"] as const
export type NonSigningStatus = (typeof NON_SIGNING_STATUSES)[number]

// Mirrors the existing getRequestMeta() pattern in src/lib/actions/portal-auth.ts
// (not exported there, so replicated locally) — first x-forwarded-for entry,
// falling back to x-real-ip, falling back to the same "unknown" sentinel
// already used by that convention. Never derived from anything the caller
// supplies.
async function getSignatureRequestMeta() {
  const hdrs = await headers()
  const forwardedFor = hdrs.get("x-forwarded-for")
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : hdrs.get("x-real-ip")?.trim() || "unknown"
  const userAgent = hdrs.get("user-agent")
  return { ip, userAgent }
}

// ── Step 5c.1 — eligible signature fields for a new request ──
//
// A field is eligible when it's a real signature field on an active
// (non-conditionally-inactive) document in this packet, and isn't already
// tied to a still-open request — reusing the exact "open" status set
// (pending/sent/viewed) NonSigningStatus/executeStaffSignature already
// treat as not-yet-final. Never guesses which field to use; the caller
// always presents the full eligible set for deliberate staff selection.
export async function getEligibleSignatureFields(packetId: string) {
  const packet = await prisma.packet.findUnique({ where: { id: packetId }, select: { organizationId: true } })
  if (!packet) throw new Error("Packet not found")
  await requireOrgAccess(packet.organizationId)

  const fields = await prisma.pdfField.findMany({
    where: {
      fieldType: "signature",
      packetDocument: { packetId, applicabilityStatus: "ACTIVE" },
      signatureRequests: { none: { status: { in: ["pending", "sent", "viewed"] } } },
    },
    include: { packetDocument: { include: { documentTemplate: { select: { name: true } } } } },
    orderBy: [{ packetDocument: { sortOrder: "asc" } }, { pageNumber: "asc" }, { sortOrder: "asc" }],
  })

  return fields.map((f) => ({
    id: f.id,
    packetDocumentId: f.packetDocumentId,
    name: f.name,
    pageNumber: f.pageNumber,
    isRequired: f.isRequired,
    documentName: f.packetDocument.documentTemplate.name,
  }))
}

// ── Step 5c.1 — eligible portal access grants for a new portal-assigned request ──
//
// Every check here mirrors setPortalSignPermission's own enablement
// predicate (Step 5b.1) exactly, plus the one additional requirement this
// step introduces: the grant must have a direct ClientContact link
// (clientContactId), since that contact is the only reliable source for a
// server-derived signer name (decision #3/#4) — a grant without one is not
// eligible, not silently worked around with a heuristic.
export async function getEligiblePortalSigningGrants(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { organizationId: true } })
  if (!client) throw new Error("Client not found")
  await requireOrgAccess(client.organizationId)

  const now = new Date()
  const grants = await prisma.portalClientAccess.findMany({
    where: {
      clientId,
      status: "ACTIVE",
      revokedAt: null,
      canSignDocuments: true,
      clientContactId: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    include: {
      portalUser: { select: { id: true, email: true, status: true, emailVerifiedAt: true } },
      clientContact: { select: { id: true, firstName: true, lastName: true, relationship: true } },
    },
  })
  if (grants.length === 0) return []

  const effectiveAuthorizations = await prisma.portalAccessAuthorization.findMany({
    where: {
      accessGrantId: { in: grants.map((g) => g.id) },
      revokedAt: null,
      acceptedAt: { not: null },
      effectiveDate: { lte: now },
      OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
    },
    select: { accessGrantId: true },
  })
  const eligibleGrantIds = new Set(effectiveAuthorizations.map((a) => a.accessGrantId))

  return grants
    .filter((g) => eligibleGrantIds.has(g.id) && g.clientContact && g.portalUser.status === "ACTIVE" && g.portalUser.emailVerifiedAt !== null)
    .map((g) => ({
      accessGrantId: g.id,
      portalUserId: g.portalUserId,
      email: g.portalUser.email,
      contactName: `${g.clientContact!.firstName} ${g.clientContact!.lastName}`,
      relationship: g.clientContact!.relationship,
      accessRole: g.accessRole,
    }))
}

// ── Step 5c.1 — create a signature request (staff- or portal-assigned) ──
//
// A discriminated union input (createSignatureRequestSchema) makes partial
// portal assignment impossible at the type level: only assignmentType
// "PORTAL" carries accessGrantId, and portalUserId/clientContactId/
// signerName/signerEmail are always derived server-side from that grant —
// never accepted from the caller. Every request created here — staff or
// portal — must link to a real packetDocument and a real signature-type
// PdfField with non-empty consent text; the previous packet-only shape is
// no longer produced by this action. No portal execution happens here —
// this only creates the row a later step (5c.2) may execute.
export async function createSignatureRequest(raw: Record<string, unknown>): Promise<ActionResult> {
  const parsed = validate(createSignatureRequestSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const rl = checkRateLimit(limiters.signature, user.id as string)
    if (rl) return rl
    const orgId = user.activeOrganizationId as string
    await requireOrgAccess(orgId)
    if (!REQUEST_ROLES.includes(getActiveRole(user as any)) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const packet = await prisma.packet.findUnique({ where: { id: data.packetId } })
    if (!packet || packet.organizationId !== orgId) return { success: false, error: "Packet not found" }

    const packetDocument = await prisma.packetDocument.findUnique({ where: { id: data.packetDocumentId } })
    if (!packetDocument || packetDocument.packetId !== packet.id) {
      return { success: false, error: "The selected document does not belong to this packet." }
    }
    if (packetDocument.applicabilityStatus !== "ACTIVE") {
      return { success: false, error: "This document is currently not applicable and cannot receive a signature request." }
    }

    const field = await prisma.pdfField.findUnique({ where: { id: data.pdfFieldId } })
    if (!field || field.packetDocumentId !== packetDocument.id) {
      return { success: false, error: "The selected field does not belong to the selected document." }
    }
    if (field.fieldType !== "signature") {
      return { success: false, error: "The selected field is not a signature field." }
    }
    const openRequestOnField = await prisma.signatureRequest.findFirst({
      where: { pdfFieldId: field.id, status: { in: ["pending", "sent", "viewed"] } },
      select: { id: true },
    })
    if (openRequestOnField) {
      return { success: false, error: "This signature field already has an open signature request." }
    }

    let signerFields: {
      signerName: string; signerEmail: string; signerRole: string; signerType: string
      portalUserId: string | null; clientContactId: string | null; accessGrantId: string | null
    }

    if (data.assignmentType === "PORTAL") {
      const grant = await prisma.portalClientAccess.findUnique({
        where: { id: data.accessGrantId },
        include: {
          portalUser: { select: { email: true, status: true, emailVerifiedAt: true } },
          clientContact: { select: { firstName: true, lastName: true, clientId: true } },
        },
      })
      if (!grant || grant.organizationId !== orgId || grant.clientId !== packet.clientId) {
        return { success: false, error: "The selected portal access grant does not belong to this client." }
      }
      const now = new Date()
      if (grant.status !== "ACTIVE" || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now)) {
        return { success: false, error: "This access grant is not active and cannot receive a signature request." }
      }
      if (!grant.canSignDocuments) {
        return { success: false, error: "Signing permission has not been enabled for this access grant." }
      }
      if (grant.portalUser.status !== "ACTIVE" || !grant.portalUser.emailVerifiedAt) {
        return { success: false, error: "The portal user for this access grant is not an active, verified account." }
      }
      if (!grant.clientContactId || !grant.clientContact) {
        return { success: false, error: "This access grant has no linked contact record and cannot be assigned a signature request." }
      }
      // Belt-and-suspenders: PortalInvitation's creation-time check already
      // guarantees a grant's clientContactId always belongs to its own
      // clientId (portal-invitations.ts), and clientContactId is never
      // reassigned afterward — but re-verify here rather than trust that
      // invariant silently, matching requirePortalClientAccess's own
      // redundant organizationId re-check.
      if (grant.clientContact.clientId !== packet.clientId) {
        return { success: false, error: "The linked contact does not belong to this client." }
      }

      const authorization = await prisma.portalAccessAuthorization.findFirst({
        where: {
          accessGrantId: grant.id,
          portalUserId: grant.portalUserId,
          clientId: packet.clientId,
          revokedAt: null,
          acceptedAt: { not: null },
          effectiveDate: { lte: now },
          OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
        },
      })
      if (!authorization) {
        return { success: false, error: "No accepted, effective signing authorization exists for this access grant." }
      }

      signerFields = {
        signerName: `${grant.clientContact.firstName} ${grant.clientContact.lastName}`,
        signerEmail: grant.portalUser.email,
        signerRole: grant.accessRole,
        signerType: "portal",
        portalUserId: grant.portalUserId,
        clientContactId: grant.clientContactId,
        accessGrantId: grant.id,
      }
    } else {
      signerFields = {
        signerName: data.signerName, signerEmail: data.signerEmail,
        signerRole: data.signerRole, signerType: data.signerType,
        portalUserId: null, clientContactId: null, accessGrantId: null,
      }
    }

    const req = await prisma.signatureRequest.create({
      data: {
        organizationId: orgId, packetId: packet.id,
        packetDocumentId: packetDocument.id, pdfFieldId: field.id,
        ...signerFields,
        status: "pending", dueDate: data.dueDate ? new Date(data.dueDate) : null,
        consentText: data.consentText, notes: data.notes || null,
        requestedById: user.id as string,
      },
    })

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string,
      action: "SIGNATURE_REQUESTED", targetType: "signature_request", targetId: req.id,
      metadata: { signerName: signerFields.signerName, signerEmail: signerFields.signerEmail, packetId: packet.id, assignmentType: data.assignmentType },
    })

    revalidatePath("/signatures")
    revalidatePath(`/packets/${packet.id}`)
    return { success: true, data: { id: req.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// Step 5a.1 — "signed" is deliberately not a member of NonSigningStatus, so
// passing it is a TypeScript compile-time error at every call site, backed
// by the same restriction at the zod layer for any caller that bypasses
// static typing. executeStaffSignature (below) is the only approved path to
// "signed" as of this step.
export async function updateSignatureStatus(requestId: string, rawStatus: NonSigningStatus, metadata?: Record<string, unknown>) {
  const statusParsed = validate(z.object({ status: z.enum(NON_SIGNING_STATUSES) }), { status: rawStatus })
  if (!statusParsed.success) return { success: false as const, error: statusParsed.error }
  const { status } = statusParsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const req = await prisma.signatureRequest.findUnique({ where: { id: requestId } })
  if (!req) return { success: false as const, error: "Not found" }
  await requireOrgAccess(req.organizationId)

  const updateData: Record<string, unknown> = { status }
  if (status === "declined" && metadata?.declineReason) updateData.declineReason = metadata.declineReason

  await prisma.signatureRequest.update({ where: { id: requestId }, data: updateData as any })

  await prisma.signatureEvent.create({
    data: { signatureRequestId: requestId, eventType: status, metadata: (metadata || {}) as any, createdById: user.id as string },
  })

  const actionMap: Record<string, string> = {
    sent: "SIGNATURE_SENT", viewed: "SIGNATURE_VIEWED",
    declined: "SIGNATURE_DECLINED", cancelled: "SIGNATURE_CANCELLED",
  }
  const auditAction = actionMap[status]
  if (auditAction) {
    await createAuditEvent({
      organizationId: req.organizationId, actorId: user.id as string,
      action: auditAction as any, targetType: "signature_request", targetId: requestId,
      metadata: { signerName: req.signerName, ...metadata },
    })
  }

  revalidatePath("/signatures")
  return { success: true as const, data: { id: requestId, status } }
}

export interface ExecuteStaffSignatureResult {
  requestId: string
  status: "signed"
  signedAt: string
  remainingIncompleteSignatures: number
  allRequiredSignaturesComplete: boolean
}

// Alias kept distinct (not merged into ExecuteStaffSignatureResult) so the
// staff and portal action contracts can diverge later without a shared type
// forcing them to stay identical — they simply happen to have the same
// shape today.
export type ExecutePortalSignatureResult = ExecuteStaffSignatureResult

// ── Step 5c.2 — shared identity-independent execution transaction ──
//
// Records exactly one actor per SignatureEvent — a staff execution sets
// createdById and leaves portalUserId null; a portal execution sets
// portalUserId and leaves createdById null. Never both. Everything here is
// intentionally identity-agnostic: field/document re-verification, the
// conditional-updateMany concurrency gate, deterministic field-value
// formatting, the SignatureEvent, both audit writes, and the remaining-
// count query are all identical regardless of who signed. Staff-specific
// authorization (org role, self-signer-email match, typed-name match,
// consent) and portal-specific authorization (grant/authorization
// re-verification) deliberately stay in their own calling functions, never
// here — this function only runs once every one of those has already
// passed.
type SignatureExecutionActor =
  | { type: "staff"; userId: string }
  | { type: "portal"; portalUserId: string; organizationId: string; clientId: string; accessGrantId: string }

interface SignatureExecutionParams {
  requestId: string
  packetDocumentId: string
  pdfFieldId: string
  organizationId: string
  packetId: string | null
  signerName: string
  signerDisplayName: string
  signedAt: Date
  ip: string
  userAgent: string | null
  actor: SignatureExecutionActor
}

async function executeSignatureTransaction(
  tx: Prisma.TransactionClient,
  params: SignatureExecutionParams
): Promise<{ remainingIncompleteSignatures: number }> {
  const { requestId, packetDocumentId, pdfFieldId, organizationId, packetId, signerName, signerDisplayName, signedAt, ip, userAgent, actor } = params

  // Re-verify field ownership and type inside the transaction — never trust
  // the outer, pre-transaction read for this.
  const field = await tx.pdfField.findUnique({ where: { id: pdfFieldId } })
  if (!field || field.packetDocumentId !== packetDocumentId) {
    throw new Error("The linked signature field could not be verified.")
  }
  if (field.fieldType !== "signature") {
    throw new Error("The linked field is not a signature field.")
  }

  // Re-verify the document's organization, applicability, and lock status
  // inside the transaction too.
  const doc = await tx.packetDocument.findUnique({ where: { id: packetDocumentId }, include: { packet: true } })
  if (!doc || doc.packet.organizationId !== organizationId) {
    throw new Error("The linked document could not be verified.")
  }
  if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
    throw new Error("This document is currently not applicable based on packet conditions and cannot be signed.")
  }
  if (doc.packet.status === "approved" || doc.packet.status === "archived") {
    throw new Error("This document is approved and locked for editing.")
  }

  // The concurrency gate: only a request currently "sent" or "viewed"
  // transitions to "signed", and exactly one concurrent caller can ever win
  // this — a conditional update, never a read-then-write. This remains the
  // sole double-signing gate for both staff and portal execution.
  const updateResult = await tx.signatureRequest.updateMany({
    where: { id: requestId, status: { in: ["sent", "viewed"] } },
    data: { status: "signed", signedAt, signedIp: ip, signedUserAgent: userAgent },
  })
  if (updateResult.count !== 1) {
    throw new Error("This signature request has already been completed.")
  }

  const fieldValue = formatSignedFieldValue(signerDisplayName, signedAt)
  await tx.pdfField.update({ where: { id: field.id }, data: { value: fieldValue } })

  await tx.signatureEvent.create({
    data: {
      signatureRequestId: requestId,
      eventType: "signed",
      ipAddress: ip,
      userAgent,
      createdById: actor.type === "staff" ? actor.userId : null,
      portalUserId: actor.type === "portal" ? actor.portalUserId : null,
      metadata: actor.type === "staff" ? { method: "staff_self_signature" } : { method: "portal_signature" },
    },
  })

  // Staff-facing AuditEvent — created for both staff and portal execution,
  // so a portal-signed document remains visible in the org-wide compliance
  // audit surfaces staff already use. actorId is left unset for a portal
  // signature (never a PortalUser id in the staff User FK) — the portal
  // signer's identity lives in structured metadata instead, matching the
  // existing actorId:undefined convention already used for non-staff-
  // actor events elsewhere in this codebase.
  const staffAuditMetadata =
    actor.type === "portal"
      ? { packetId, packetDocumentId, signerName, method: "portal_signature", portalUserId: actor.portalUserId, accessGrantId: actor.accessGrantId }
      : { packetId, packetDocumentId, signerName }
  await createAuditEvent({
    organizationId,
    actorId: actor.type === "staff" ? actor.userId : undefined,
    action: "SIGNATURE_COMPLETED",
    targetType: "signature_request",
    targetId: requestId,
    ipAddress: ip,
    userAgent,
    metadata: staffAuditMetadata,
  }, tx)

  // Portal-facing audit — records the portal actor and portal activity,
  // reusing the previously dormant PORTAL_SIGNATURE_SIGNED value.
  if (actor.type === "portal") {
    await createPortalAuditEvent({
      organizationId: actor.organizationId,
      portalUserId: actor.portalUserId,
      clientId: actor.clientId,
      action: "PORTAL_SIGNATURE_SIGNED",
      targetType: "signature_request",
      targetId: requestId,
      ipAddress: ip,
      userAgent: userAgent ?? undefined,
      metadata: { packetId, packetDocumentId, accessGrantId: actor.accessGrantId },
    }, tx)
  }

  const remainingIncompleteSignatures = packetId
    ? await tx.signatureRequest.count({ where: { packetId, status: { in: ["pending", "sent", "viewed"] } } })
    : 0

  return { remainingIncompleteSignatures }
}

// ── Step 5a.1 — Staff Signature Execution Foundation ──
//
// The only approved path to a "signed" SignatureRequest. Staff-self-
// signature only: the acting user must be the person named as signerEmail
// on the request — this does not support staff signing for a client,
// guardian, or a different staff member, recording an external signature,
// or any form of proxy/impersonated execution. Those are separately
// designed, out-of-scope workflows.
//
// Nothing about organization identity, packet/document/field relationships,
// current status, timestamp, IP, or user-agent is ever taken from the
// caller — all of it is loaded fresh or derived on the server, and the
// packet-document/field relationships are re-verified a second time inside
// the transaction rather than trusted from the pre-transaction read, per
// this codebase's existing saveDocumentFields convention.
export async function executeStaffSignature(
  requestId: string,
  input: { signerName: string; consentAccepted: boolean }
): Promise<{ success: true; data: ExecuteStaffSignatureResult } | { success: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const actorId = user.id as string
    const rl = checkRateLimit(limiters.signature, actorId)
    if (rl) return rl
    const actorEmail = ((user.email as string) || "").trim().toLowerCase()

    const req = await prisma.signatureRequest.findUnique({
      where: { id: requestId },
      include: { packetDocument: { include: { packet: true } } },
    })
    if (!req) return { success: false, error: "Signature request not found" }

    await requireOrgAccess(req.organizationId)
    const role = getActiveRole(user as any)
    if (!EXECUTION_ROLES.includes(role) && !(user.isSuperAdmin as boolean)) {
      return { success: false, error: "Insufficient permissions" }
    }

    // Staff-self-signature identity check — the only authorization
    // mechanism available given signerRole/signerType are unstructured free
    // text with no reliable "this is a staff signer" flag.
    if (!req.signerEmail || !req.signerEmail.trim()) {
      return { success: false, error: "This request has no signer email on file and cannot be executed." }
    }
    if (req.signerEmail.trim().toLowerCase() !== actorEmail) {
      return { success: false, error: "You are not the signer named on this request." }
    }

    const typedName = (input.signerName || "").trim()
    if (!typedName) return { success: false, error: "Enter your name to sign." }
    if (normalizeSignerName(typedName) !== normalizeSignerName(req.signerName)) {
      return { success: false, error: "The name you entered does not match the signer name on this request." }
    }

    if (input.consentAccepted !== true) {
      return { success: false, error: "You must accept the consent statement to sign." }
    }
    if (!req.consentText || !req.consentText.trim()) {
      return { success: false, error: "This request has no consent language configured and cannot be signed yet." }
    }

    if (!req.packetDocumentId || !req.packetDocument) {
      return { success: false, error: "This request is not linked to a packet document." }
    }
    if (!req.pdfFieldId) {
      return { success: false, error: "This request is not linked to a signature field." }
    }
    if (req.packetDocument.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
      return { success: false, error: "This document is currently not applicable based on packet conditions and cannot be signed." }
    }
    if (req.packetDocument.packet.status === "approved" || req.packetDocument.packet.status === "archived") {
      return { success: false, error: "This document is approved and locked for editing." }
    }

    const { ip, userAgent } = await getSignatureRequestMeta()
    const signedAt = new Date()
    const packetDocumentId = req.packetDocumentId
    const pdfFieldId = req.pdfFieldId

    const txResult = await prisma.$transaction((tx) =>
      executeSignatureTransaction(tx, {
        requestId, packetDocumentId, pdfFieldId,
        organizationId: req.organizationId, packetId: req.packetId,
        signerName: req.signerName,
        signerDisplayName: normalizeDisplayName(typedName),
        signedAt, ip, userAgent,
        actor: { type: "staff", userId: actorId },
      })
    )

    revalidatePath("/signatures")
    revalidatePath(`/signatures/${requestId}`)

    return {
      success: true,
      data: {
        requestId,
        status: "signed",
        signedAt: signedAt.toISOString(),
        remainingIncompleteSignatures: txResult.remainingIncompleteSignatures,
        allRequiredSignaturesComplete: txResult.remainingIncompleteSignatures === 0,
      },
    }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Step 5c.2 — Portal Signature Execution Action ──
//
// The only approved path for a portal user to sign their own assigned
// request. Structurally mirrors executeStaffSignature but with entirely
// different outer authorization: a live portal session, an exact
// portalUserId/accessGrantId match against the request, a live
// canSignDocuments check, and a live accepted/effective/non-revoked
// PortalAccessAuthorization — never signerEmail alone, since the
// structured grant/portal-user/contact/client relationships already
// established in Step 5c.1 are authoritative here.
//
// Nothing about organization, client, grant, authorization, contact,
// packet/document/field relationships, timestamp, IP, or user-agent is
// ever taken from the caller. Portal permission and authorization are
// legally significant and revocable, so every one of those checks is
// re-verified a second time inside the transaction, immediately before
// the request's status transition — the outer checks are a UX
// convenience, never treated as sufficient on their own.
export async function executePortalSignature(
  requestId: string,
  input: { signerName: string; consentAccepted: boolean }
): Promise<{ success: true; data: ExecutePortalSignatureResult } | { success: false; error: string }> {
  try {
    const req = await prisma.signatureRequest.findUnique({
      where: { id: requestId },
      include: { packetDocument: { include: { packet: true } } },
    })
    if (!req) return { success: false, error: "Signature request not found" }

    // The portal-assignment invariant from Step 5c.1: all three or none.
    // A staff request (all null) or a partially-assigned row can never be
    // executed through this action.
    if (!req.portalUserId || !req.accessGrantId || !req.clientContactId) {
      return { success: false, error: "This request is not assigned to a portal signer." }
    }
    if (!req.packetDocumentId || !req.packetDocument || !req.pdfFieldId) {
      return { success: false, error: "This request is not linked to a signature field." }
    }

    const rl = checkRateLimit(limiters.signature, req.portalUserId)
    if (rl) return rl

    const clientId = req.packetDocument.packet.clientId

    // Live portal session + live, unexpired/unrevoked grant + live
    // canSignDocuments check — nothing here is trusted from a prior page
    // render.
    const context = await requirePortalPermission(clientId, "canSignDocuments")

    if (req.portalUserId !== context.portalUserId) {
      return { success: false, error: "You are not the signer assigned to this request." }
    }
    if (req.accessGrantId !== context.accessId) {
      return { success: false, error: "This request is not linked to your current access grant." }
    }

    const contact = await prisma.clientContact.findUnique({ where: { id: req.clientContactId } })
    if (!contact || contact.clientId !== clientId) {
      return { success: false, error: "The signer contact for this request could not be verified." }
    }

    const now = new Date()
    const authorization = await prisma.portalAccessAuthorization.findFirst({
      where: {
        accessGrantId: req.accessGrantId,
        portalUserId: req.portalUserId,
        clientId,
        revokedAt: null,
        acceptedAt: { not: null },
        effectiveDate: { lte: now },
        OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
      },
    })
    if (!authorization) {
      return { success: false, error: "No accepted, effective signing authorization exists for this access grant." }
    }

    // Typed-name comparison against the Step 5c.1 server-derived
    // ClientContact snapshot on the request — the same normalization
    // helper executeStaffSignature already uses, never a new comparison
    // mechanism.
    const typedName = (input.signerName || "").trim()
    if (!typedName) return { success: false, error: "Enter your name to sign." }
    if (normalizeSignerName(typedName) !== normalizeSignerName(req.signerName)) {
      return { success: false, error: "The name you entered does not match the signer name on this request." }
    }

    if (input.consentAccepted !== true) {
      return { success: false, error: "You must accept the consent statement to sign." }
    }
    if (!req.consentText || !req.consentText.trim()) {
      return { success: false, error: "This request has no consent language configured and cannot be signed yet." }
    }

    if (req.packetDocument.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
      return { success: false, error: "This document is currently not applicable based on packet conditions and cannot be signed." }
    }
    if (req.packetDocument.packet.status === "approved" || req.packetDocument.packet.status === "archived") {
      return { success: false, error: "This document is approved and locked for editing." }
    }
    if (req.status !== "sent" && req.status !== "viewed") {
      return { success: false, error: "This signature request has already been completed." }
    }

    const { ip, userAgent } = await getSignatureRequestMeta()
    const signedAt = new Date()
    const packetDocumentId = req.packetDocumentId
    const pdfFieldId = req.pdfFieldId
    const accessGrantId = req.accessGrantId
    const portalUserId = req.portalUserId
    const organizationId = req.organizationId
    const clientContactId = req.clientContactId

    const txResult = await prisma.$transaction(async (tx) => {
      // Second, transactional re-verification — portal permission and
      // authorization are legally significant and revocable, so the outer
      // checks above are not treated as sufficient. A revocation,
      // permission disablement, grant expiry, reassignment, or contact
      // change that wins the race against this transaction is caught here,
      // before the status transition, not after.
      const grant = await tx.portalClientAccess.findUnique({ where: { id: accessGrantId } })
      if (!grant || grant.portalUserId !== portalUserId || grant.clientId !== clientId || grant.organizationId !== organizationId) {
        throw new Error("This request is no longer linked to your access grant.")
      }
      if (grant.status !== "ACTIVE" || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= signedAt)) {
        throw new Error("Your access grant is no longer active.")
      }
      if (!grant.canSignDocuments) {
        throw new Error("Signing permission is no longer enabled for your access grant.")
      }

      const txAuthorization = await tx.portalAccessAuthorization.findFirst({
        where: {
          accessGrantId, portalUserId, clientId,
          revokedAt: null,
          acceptedAt: { not: null },
          effectiveDate: { lte: signedAt },
          OR: [{ expirationDate: null }, { expirationDate: { gt: signedAt } }],
        },
      })
      if (!txAuthorization) {
        throw new Error("Your signing authorization is no longer accepted and effective.")
      }

      const txContact = await tx.clientContact.findUnique({ where: { id: clientContactId } })
      if (!txContact || txContact.clientId !== clientId) {
        throw new Error("The signer contact for this request could not be verified.")
      }

      const txReq = await tx.signatureRequest.findUnique({ where: { id: requestId } })
      if (!txReq || txReq.portalUserId !== portalUserId || txReq.accessGrantId !== accessGrantId) {
        throw new Error("This request has been reassigned and can no longer be executed.")
      }

      return executeSignatureTransaction(tx, {
        requestId, packetDocumentId, pdfFieldId,
        organizationId, packetId: req.packetId,
        signerName: req.signerName,
        signerDisplayName: normalizeDisplayName(typedName),
        signedAt, ip, userAgent,
        actor: { type: "portal", portalUserId, organizationId, clientId, accessGrantId },
      })
    })

    revalidatePath(`/signatures/${requestId}`)

    return {
      success: true,
      data: {
        requestId,
        status: "signed",
        signedAt: signedAt.toISOString(),
        remainingIncompleteSignatures: txResult.remainingIncompleteSignatures,
        allRequiredSignaturesComplete: txResult.remainingIncompleteSignatures === 0,
      },
    }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getSignatureRequests(orgId: string, raw?: Record<string, unknown>) {
  const p = validate(z.object({ status: z.string().max(30).optional(), packetId: z.string().max(50).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }), raw || {})
  const params = p.success ? p.data : { page: 1, pageSize: 20 }
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.packetId) where.packetId = params.packetId

  const [requests, total] = await Promise.all([
    prisma.signatureRequest.findMany({
      where: where as any, orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        requestedBy: { select: { name: true } },
        packet: { select: { packetType: true, status: true, client: { select: { firstName: true, lastName: true } } } },
        _count: { select: { events: true } },
      },
    }),
    prisma.signatureRequest.count({ where: where as any }),
  ])
  return { requests, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getSignatureDetail(requestId: string) {
  const req = await prisma.signatureRequest.findUnique({
    where: { id: requestId },
    include: {
      requestedBy: { select: { name: true, email: true } },
      packet: { include: { client: { select: { firstName: true, lastName: true, mcadId: true } } } },
      packetDocument: { include: { documentTemplate: { select: { name: true } } } },
      pdfField: { select: { name: true, fieldType: true, value: true } },
      events: { orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } },
    },
  })
  if (!req) return null
  await requireOrgAccess(req.organizationId)
  return req
}

// ── Step 5c.3 — portal read models (discovery + the signing ceremony) ──
//
// "Eligible" here mirrors the exact live checks executePortalSignature
// itself re-verifies at submit time (canSignDocuments + an accepted,
// effective, non-revoked authorization) — this is a UX convenience only,
// never a substitute for that action's own authoritative re-checks.

// ── Portal: whether the current client has an actionable pending signature ──
//
// Scoped strictly to the caller's own, currently active grant —
// requirePortalClientAccess re-verifies that live. Returns the oldest
// eligible request's id (for the dashboard prompt's link) and the total
// eligible count — never the full list, per the approved "no signature
// list" scope for this step.
export interface PortalPendingSignaturePrompt {
  requestId: string
  count: number
}

export async function getPendingPortalSignatureRequest(clientId: string): Promise<PortalPendingSignaturePrompt | null> {
  const context = await requirePortalClientAccess(clientId)
  if (!context.permissions.canSignDocuments) return null

  const now = new Date()
  const authorization = await prisma.portalAccessAuthorization.findFirst({
    where: {
      accessGrantId: context.accessId, portalUserId: context.portalUserId, clientId,
      revokedAt: null, acceptedAt: { not: null },
      effectiveDate: { lte: now },
      OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
    },
  })
  if (!authorization) return null

  const requests = await prisma.signatureRequest.findMany({
    where: { portalUserId: context.portalUserId, accessGrantId: context.accessId, status: { in: ["sent", "viewed"] } },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  })
  if (requests.length === 0) return null

  return { requestId: requests[0].id, count: requests.length }
}

// ── Portal: the full detail for one request's signing ceremony ──
//
// Scoped by a single query to exactly the caller's own portalUserId +
// accessGrantId — a request belonging to a different portal user, a
// different grant, or a different client than the one requested is
// structurally unreachable here (the query returns nothing), never
// revealed and never distinguished from "not found".
export interface PortalSignatureRequestDetail {
  id: string
  status: string
  signerName: string
  consentText: string
  dueDate: Date | null
  clientDisplayName: string
  documentName: string
  packetType: string | null
  isOverdue: boolean
  eligible: boolean
  ineligibleReason: "not_enabled" | "not_authorized" | null
}

export async function getPortalSignatureRequestForClient(requestId: string, clientId: string): Promise<PortalSignatureRequestDetail | null> {
  const context = await requirePortalClientAccess(clientId)

  const req = await prisma.signatureRequest.findFirst({
    where: { id: requestId, portalUserId: context.portalUserId, accessGrantId: context.accessId },
    include: {
      packet: { select: { packetType: true, client: { select: { firstName: true, lastName: true } } } },
      packetDocument: { select: { documentTemplate: { select: { name: true } } } },
    },
  })
  if (!req) return null

  let eligible = context.permissions.canSignDocuments
  let ineligibleReason: "not_enabled" | "not_authorized" | null = eligible ? null : "not_enabled"
  if (eligible) {
    const now = new Date()
    const authorization = await prisma.portalAccessAuthorization.findFirst({
      where: {
        accessGrantId: context.accessId, portalUserId: context.portalUserId, clientId,
        revokedAt: null, acceptedAt: { not: null },
        effectiveDate: { lte: now },
        OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
      },
    })
    if (!authorization) {
      eligible = false
      ineligibleReason = "not_authorized"
    }
  }

  return {
    id: req.id,
    status: req.status,
    signerName: req.signerName,
    consentText: req.consentText ?? "",
    dueDate: req.dueDate,
    clientDisplayName: req.packet ? `${req.packet.client.firstName} ${req.packet.client.lastName}` : "",
    documentName: req.packetDocument?.documentTemplate.name ?? "",
    packetType: req.packet?.packetType ?? null,
    isOverdue: Boolean(req.dueDate && req.dueDate < new Date()),
    eligible,
    ineligibleReason,
  }
}
