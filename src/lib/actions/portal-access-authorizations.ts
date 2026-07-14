"use server"

// ── Stage 5 Step 5b.1 — Portal Signing Authorization Foundation ──
// Staff-facing actions (below): create/list/revoke an authorization,
// enable/disable canSignDocuments. Nothing here ever sets
// acceptedAt/acceptedIp/acceptedUserAgent — staff cannot manufacture
// consent on a portal user's behalf through anything in this section.
//
// ── Stage 5 Step 5b.2 — Portal Consent Acceptance ──
// Portal-facing actions (bottom of file): the authenticated portal user's
// own read of their pending authorization and their own acceptance action.
// No portal signing action or UI exists anywhere in this file — acceptance
// never touches canSignDocuments.
import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { requirePortalClientAccess } from "@/lib/portal/auth"
import { createAuditEvent, createPortalAuditEvent } from "@/lib/audit"
import { validate, createPortalAccessAuthorizationSchema } from "@/lib/validation"
import { UserRole } from "@prisma/client"

type ActionResult<T = Record<string, unknown>> = { success: true; data: T } | { success: false; error: string }

// Same narrow role set already established for managing portal grant
// permissions (setPortalUploadPermission's STAFF_MANAGE_ROLES) — legal-
// authority verification is at least as sensitive as upload permission,
// never broadened to CASE_MANAGER without explicit approval.
const AUTHORIZATION_MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

async function requireAuthorizationManager(orgId: string) {
  const user = await requireOrgAccess(orgId)
  const role = getActiveRole(user)
  if (!user.isSuperAdmin && !AUTHORIZATION_MANAGE_ROLES.includes(role)) {
    throw new Error("Insufficient permissions")
  }
  return user
}

// Step 5b.1 uses only client-wide scope, recorded deterministically — never
// an open-ended, staff-editable scope object. Request/document-specific
// scoping is explicitly deferred to a later step.
const CLIENT_WIDE_SCOPE = { type: "CLIENT_WIDE" } as const

// ── Staff: create a pending signing authorization ──
//
// Always creates a PENDING record: acceptedAt/acceptedIp/acceptedUserAgent
// are never set here, and canSignDocuments on the linked grant is never
// touched by this action. Acceptance is exclusively a portal-user action in
// a future step.
export async function createPortalAccessAuthorization(raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createPortalAccessAuthorizationSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  try {
    const grant = await prisma.portalClientAccess.findUnique({ where: { id: data.accessGrantId } })
    if (!grant) return { success: false, error: "Access grant not found" }

    const user = await requireAuthorizationManager(grant.organizationId)

    if (grant.status !== "ACTIVE" || grant.revokedAt) {
      return { success: false, error: "This access grant is not active and cannot receive a new authorization." }
    }

    let supportingDocumentId: string | null = null
    if (data.supportingDocumentId) {
      const doc = await prisma.supportingDocument.findUnique({ where: { id: data.supportingDocumentId } })
      if (!doc || doc.organizationId !== grant.organizationId || doc.clientId !== grant.clientId) {
        return { success: false, error: "The supporting document does not belong to this client." }
      }
      supportingDocumentId = doc.id
    }

    const effectiveDate = new Date(data.effectiveDate)
    const expirationDate = data.expirationDate ? new Date(data.expirationDate) : null
    if (expirationDate && expirationDate <= effectiveDate) {
      return { success: false, error: "The expiration date must be after the effective date." }
    }

    // Conflict check: any existing, non-revoked authorization for this same
    // grant that hasn't yet expired (accepted-and-effective, or still
    // pending acceptance) blocks a new one — an expired or revoked prior
    // authorization does not.
    const now = new Date()
    const conflict = await prisma.portalAccessAuthorization.findFirst({
      where: {
        accessGrantId: grant.id,
        revokedAt: null,
        OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
      },
    })
    if (conflict) {
      return { success: false, error: "An active or pending authorization already exists for this access grant." }
    }

    const authorization = await prisma.portalAccessAuthorization.create({
      data: {
        clientId: grant.clientId,
        portalUserId: grant.portalUserId,
        accessGrantId: grant.id,
        grantedByUserId: user.id,
        authorityType: data.authorityType,
        scope: CLIENT_WIDE_SCOPE,
        effectiveDate,
        expirationDate,
        supportingDocumentId,
        consentText: data.consentText,
        consentVersion: data.consentVersion,
      },
    })

    await createAuditEvent({
      organizationId: grant.organizationId,
      actorId: user.id,
      action: "PORTAL_ACCESS_AUTHORIZATION_CREATED",
      targetType: "portal_access_authorization",
      targetId: authorization.id,
      metadata: {
        accessGrantId: grant.id, clientId: grant.clientId, portalUserId: grant.portalUserId,
        authorityType: data.authorityType, consentVersion: data.consentVersion,
      },
    })

    revalidatePath(`/clients/${grant.clientId}/portal-access`)
    return { success: true, data: { id: authorization.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Staff: list every authorization recorded for a client, newest first ──
export async function getPortalAccessAuthorizations(clientId: string) {
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { organizationId: true } })
  if (!client) throw new Error("Client not found")
  await requireAuthorizationManager(client.organizationId)

  return prisma.portalAccessAuthorization.findMany({
    where: { clientId },
    include: {
      portalUser: { select: { id: true, email: true } },
      grantedBy: { select: { name: true, email: true } },
      revokedBy: { select: { name: true, email: true } },
      supportingDocument: { select: { id: true, title: true } },
    },
    orderBy: { createdAt: "desc" },
  })
}

// ── Staff: revoke an authorization and immediately remove signing permission ──
//
// Atomic: the conditional updateMany is the concurrency gate (mirrors the
// same idiom already established in executeStaffSignature/the portal
// upload route) — a second concurrent revoke attempt sees count !== 1 and
// is rejected, never double-processed. Never deletes the record, never
// clears acceptedAt/acceptedIp/acceptedUserAgent, never reactivable —
// a new authorization must be created if authority is granted again.
export async function revokePortalAccessAuthorization(authorizationId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const authorization = await prisma.portalAccessAuthorization.findUnique({ where: { id: authorizationId } })
    if (!authorization) return { success: false, error: "Authorization not found" }

    const grant = await prisma.portalClientAccess.findUnique({ where: { id: authorization.accessGrantId } })
    if (!grant) return { success: false, error: "The linked access grant could not be found" }

    const user = await requireAuthorizationManager(grant.organizationId)

    const result = await prisma.$transaction(async (tx) => {
      const updateResult = await tx.portalAccessAuthorization.updateMany({
        where: { id: authorizationId, revokedAt: null },
        data: { revokedAt: new Date(), revokedByUserId: user.id },
      })
      if (updateResult.count !== 1) {
        throw new Error("This authorization has already been revoked.")
      }

      await tx.portalClientAccess.update({
        where: { id: grant.id },
        data: { canSignDocuments: false },
      })

      await createAuditEvent({
        organizationId: grant.organizationId,
        actorId: user.id,
        action: "PORTAL_ACCESS_AUTHORIZATION_REVOKED",
        targetType: "portal_access_authorization",
        targetId: authorizationId,
        metadata: { accessGrantId: grant.id, clientId: grant.clientId },
      }, tx)

      return { id: authorizationId }
    })

    revalidatePath(`/clients/${grant.clientId}/portal-access`)
    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Staff: enable/disable signing on an access grant ──
//
// Enabling requires ALL of: the grant itself active/unexpired/non-revoked,
// AND a matching authorization (same portalUserId/clientId/accessGrantId)
// that is accepted, effective as of now, not expired, and not revoked. This
// predicate is the sole gate — portal-user acceptance alone never enables
// signing, and staff creating an authorization alone never enables signing
// either; both must independently be true before this action will succeed.
// Disabling has no preconditions and never touches the authorization
// record itself (no revocation, no evidence erased).
export async function setPortalSignPermission(accessGrantId: string, enabled: boolean): Promise<ActionResult<{ id: string; canSignDocuments: boolean }>> {
  try {
    const grant = await prisma.portalClientAccess.findUnique({ where: { id: accessGrantId } })
    if (!grant) return { success: false, error: "Access grant not found" }

    const user = await requireAuthorizationManager(grant.organizationId)

    if (enabled) {
      const now = new Date()
      if (grant.status !== "ACTIVE" || grant.revokedAt || (grant.expiresAt && grant.expiresAt <= now)) {
        return { success: false, error: "This access grant is not active and cannot be granted signing permission." }
      }

      const authorization = await prisma.portalAccessAuthorization.findFirst({
        where: {
          accessGrantId: grant.id,
          portalUserId: grant.portalUserId,
          clientId: grant.clientId,
          revokedAt: null,
          acceptedAt: { not: null },
          effectiveDate: { lte: now },
          OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
        },
        orderBy: { createdAt: "desc" },
      })
      if (!authorization) {
        return { success: false, error: "No accepted, effective authorization exists for this access grant. Signing permission cannot be enabled." }
      }
    }

    const updated = await prisma.portalClientAccess.update({
      where: { id: accessGrantId },
      data: { canSignDocuments: enabled },
    })

    await createAuditEvent({
      organizationId: grant.organizationId,
      actorId: user.id,
      action: "PORTAL_ACCESS_SIGN_PERMISSION_CHANGED",
      targetType: "portal_client_access",
      targetId: accessGrantId,
      metadata: { canSignDocuments: enabled },
    })

    revalidatePath(`/clients/${grant.clientId}/portal-access`)
    return { success: true, data: { id: accessGrantId, canSignDocuments: updated.canSignDocuments } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Stage 5 Step 5b.2 — Portal Consent Acceptance (portal-facing) ──

async function getRequestMeta() {
  const hdrs = await headers()
  const forwardedFor = hdrs.get("x-forwarded-for")
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : hdrs.get("x-real-ip")?.trim() || "unknown"
  const userAgent = hdrs.get("user-agent")
  return { ip, userAgent }
}

export interface PortalAccessAuthorizationView {
  id: string
  authorityType: string
  consentText: string
  consentVersion: string
  effectiveDate: Date
  expirationDate: Date | null
  acceptedAt: Date | null
  revokedAt: Date | null
  hasSupportingDocument: boolean
  relationship: string
  accessRole: string
  grantCanSignDocuments: boolean
}

// ── Portal: the authenticated user's own authorization for one client ──
//
// Scoped to the caller's own, currently active PortalClientAccess grant —
// requirePortalClientAccess re-verifies that grant live on every call, so an
// authorization tied to a different, superseded, or inactive grant never
// surfaces here at all (it reads as "NONE", not as a stale revoked/expired
// record describing a defunct grant). Returns the most recent authorization
// on this grant regardless of its own accepted/revoked/expired state, so the
// caller can distinguish "never configured" from "configured but not
// currently acceptable." Never exposes grantedByUserId, staff identity, or
// the supporting document itself — only whether one is on file.
export async function getPortalAccessAuthorizationForClient(clientId: string): Promise<PortalAccessAuthorizationView | null> {
  const context = await requirePortalClientAccess(clientId)

  const authorization = await prisma.portalAccessAuthorization.findFirst({
    where: {
      accessGrantId: context.accessId,
      portalUserId: context.portalUserId,
      clientId,
    },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, authorityType: true, consentText: true, consentVersion: true,
      effectiveDate: true, expirationDate: true, acceptedAt: true, revokedAt: true,
      supportingDocumentId: true,
    },
  })
  if (!authorization) return null

  return {
    id: authorization.id,
    authorityType: authorization.authorityType,
    consentText: authorization.consentText,
    consentVersion: authorization.consentVersion,
    effectiveDate: authorization.effectiveDate,
    expirationDate: authorization.expirationDate,
    acceptedAt: authorization.acceptedAt,
    revokedAt: authorization.revokedAt,
    hasSupportingDocument: authorization.supportingDocumentId !== null,
    relationship: context.relationship,
    accessRole: context.accessRole,
    grantCanSignDocuments: context.permissions.canSignDocuments,
  }
}

// ── Portal: the authenticated user accepts their own pending authorization ──
//
// The only path that may ever populate acceptedAt/acceptedIp/acceptedUserAgent.
// Never touches PortalClientAccess.canSignDocuments — acceptance and staff
// enablement remain two fully independent writes, exactly as approved for
// Step 5b.1. The conditional updateMany is the sole concurrency gate: it
// re-checks not-yet-accepted, not-revoked, effective, and not-expired
// atomically at write time, so a stale page, a losing concurrent tab, or a
// revocation that lands first all fail this same gate with zero writes.
export async function acceptPortalAccessAuthorization(authorizationId: string): Promise<ActionResult<{ id: string; acceptedAt: Date }>> {
  try {
    const authorization = await prisma.portalAccessAuthorization.findUnique({ where: { id: authorizationId } })
    if (!authorization) return { success: false, error: "Authorization not found" }

    // requirePortalClientAccess is the authentication boundary here: it
    // independently re-verifies a live, active, unrevoked, unexpired portal
    // session and grant for this exact client — never trusted from a prior
    // page render or caller-supplied client id.
    const context = await requirePortalClientAccess(authorization.clientId)

    if (authorization.portalUserId !== context.portalUserId || authorization.accessGrantId !== context.accessId) {
      return { success: false, error: "This authorization does not belong to your account." }
    }
    if (!authorization.consentText.trim() || !authorization.consentVersion.trim()) {
      return { success: false, error: "This authorization has no consent language configured and cannot be accepted yet." }
    }

    const now = new Date()
    const { ip, userAgent } = await getRequestMeta()

    const result = await prisma.portalAccessAuthorization.updateMany({
      where: {
        id: authorizationId,
        portalUserId: context.portalUserId,
        accessGrantId: context.accessId,
        clientId: authorization.clientId,
        acceptedAt: null,
        revokedAt: null,
        effectiveDate: { lte: now },
        OR: [{ expirationDate: null }, { expirationDate: { gt: now } }],
      },
      data: { acceptedAt: now, acceptedIp: ip, acceptedUserAgent: userAgent ?? null },
    })

    if (result.count !== 1) {
      // Never overwrite existing acceptance evidence and never create an
      // audit event for a losing/repeated/stale attempt — re-read the
      // current state only to return an accurate, non-destructive message.
      const current = await prisma.portalAccessAuthorization.findUnique({ where: { id: authorizationId } })
      if (current?.revokedAt) return { success: false, error: "This signing authorization has been revoked and can no longer be accepted." }
      if (current?.acceptedAt) return { success: false, error: "This signing authorization has already been accepted." }
      if (current?.expirationDate && current.expirationDate <= now) return { success: false, error: "This signing authorization has expired." }
      if (current && current.effectiveDate > now) return { success: false, error: "This signing authorization is not yet available for acceptance." }
      return { success: false, error: "This signing authorization can no longer be accepted." }
    }

    await createPortalAuditEvent({
      organizationId: context.organizationId,
      portalUserId: context.portalUserId,
      clientId: authorization.clientId,
      action: "PORTAL_CONSENT_ACCEPTED",
      targetType: "portal_access_authorization",
      targetId: authorizationId,
      ipAddress: ip,
      userAgent: userAgent ?? undefined,
      metadata: { accessGrantId: context.accessId },
    })

    return { success: true, data: { id: authorizationId, acceptedAt: now } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
