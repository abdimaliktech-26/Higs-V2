"use server"

// ── Stage 5 Step 5b.1 — Portal Signing Authorization Foundation ──
//
// Staff-facing only. No portal consent-acceptance action, no portal
// signing action, and no signing UI exist anywhere in this file — this is
// the record-keeping/permission-gating foundation those later steps will
// build on. Nothing here ever sets acceptedAt/acceptedIp/acceptedUserAgent
// — those are exclusively written by the portal user's own future
// acceptance action (Step 5b.2); staff cannot manufacture consent on a
// portal user's behalf through anything in this file.
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
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
