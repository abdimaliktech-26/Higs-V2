"use server"

import { headers } from "next/headers"
import { revalidatePath } from "next/cache"
import bcrypt from "bcryptjs"
import { Prisma, UserRole, PortalUserStatus } from "@prisma/client"
import { prisma } from "@/lib/db"
import { requireOrganizationRole } from "@/lib/live-authorization"
import { createPortalAuditEvent } from "@/lib/audit"
import { validate, createPortalInvitationSchema, activatePortalAccountSchema } from "@/lib/validation"
import { generatePortalToken, hashPortalToken } from "@/lib/portal/tokens"
import { deriveGrantPermissions } from "@/lib/portal/permissions"
import { limiters } from "@/lib/rate-limit"

const STAFF_MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
const INVITATION_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

type ActionResult<T = Record<string, unknown>> = { success: true; data: T } | { success: false; error: string }

async function getRequestIp(): Promise<string> {
  const hdrs = await headers()
  const forwardedFor = hdrs.get("x-forwarded-for")
  if (forwardedFor) return forwardedFor.split(",")[0].trim()
  return hdrs.get("x-real-ip")?.trim() || "unknown"
}

async function requireStaffManager(orgId: string) {
  return requireOrganizationRole(orgId, STAFF_MANAGE_ROLES, "manage portal access")
}

export type InvitationDisplayStatus = "PENDING" | "ACCEPTED" | "REVOKED" | "EXPIRED"

function computeInvitationDisplayStatus(invitation: { status: string; expiresAt: Date; revokedAt: Date | null; acceptedAt: Date | null }): InvitationDisplayStatus {
  if (invitation.revokedAt) return "REVOKED"
  if (invitation.acceptedAt) return "ACCEPTED"
  if (invitation.expiresAt < new Date()) return "EXPIRED"
  return "PENDING"
}

// ── Staff: create invitation ──
export async function createPortalInvitation(raw: Record<string, unknown>): Promise<ActionResult<{ id: string; rawToken: string }>> {
  const parsed = validate(createPortalInvitationSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  try {
    // Client ownership must be verified server-side — never trust the
    // clientId form value beyond deriving the target organization from it.
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true, organizationId: true } })
    if (!client) return { success: false, error: "Client not found" }
    const authorization = await requireStaffManager(client.organizationId)
    const orgId = authorization.organizationId

    if (data.clientContactId) {
      const contact = await prisma.clientContact.findUnique({ where: { id: data.clientContactId }, select: { id: true, clientId: true } })
      if (!contact || contact.clientId !== data.clientId) {
        return { success: false, error: "Contact not found" }
      }
    }

    const { raw: rawToken, hash } = generatePortalToken()
    const invitedEmail = data.invitedEmail.toLowerCase().trim()

    const invitation = await prisma.portalInvitation.create({
      data: {
        organizationId: orgId,
        clientId: data.clientId,
        clientContactId: data.clientContactId || null,
        invitedEmail,
        relationship: data.relationship,
        invitedByUserId: authorization.userId,
        accessRole: data.accessRole,
        requestedPermissions: {
          canViewDocuments: data.canViewDocuments,
          canViewAppointments: data.canViewAppointments,
          canMessageCareTeam: data.canMessageCareTeam,
        },
        tokenHash: hash,
        expiresAt: new Date(Date.now() + INVITATION_EXPIRY_MS),
      },
    })

    await createPortalAuditEvent({
      organizationId: orgId,
      clientId: data.clientId,
      action: "PORTAL_INVITATION_SENT",
      targetType: "portal_invitation",
      targetId: invitation.id,
      metadata: { invitedEmail, accessRole: data.accessRole, invitedByUserId: authorization.userId },
    })

    revalidatePath("/settings/portal-access")
    revalidatePath(`/clients/${data.clientId}/portal-access`)

    return { success: true, data: { id: invitation.id, rawToken } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to create invitation" }
  }
}

// ── Staff: revoke invitation ──
export async function revokePortalInvitation(invitationId: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const invitation = await prisma.portalInvitation.findUnique({ where: { id: invitationId } })
    if (!invitation) return { success: false, error: "Invitation not found" }
    const authorization = await requireStaffManager(invitation.organizationId)
    const orgId = authorization.organizationId
    if (invitation.revokedAt || invitation.acceptedAt) {
      return { success: false, error: "Invitation is already accepted or revoked" }
    }

    await prisma.portalInvitation.update({
      where: { id: invitationId },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: authorization.userId },
    })

    await createPortalAuditEvent({
      organizationId: orgId,
      clientId: invitation.clientId,
      action: "PORTAL_INVITATION_REVOKED",
      targetType: "portal_invitation",
      targetId: invitationId,
      metadata: { reason: reason || null },
    })

    revalidatePath("/settings/portal-access")
    revalidatePath(`/clients/${invitation.clientId}/portal-access`)

    return { success: true, data: { id: invitationId } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to revoke invitation" }
  }
}

// ── Staff: list invitations (org-wide or per-client) ──
export async function getPortalInvitations(orgId: string, clientId?: string) {
  await requireStaffManager(orgId)
  const invitations = await prisma.portalInvitation.findMany({
    where: { organizationId: orgId, ...(clientId ? { clientId } : {}) },
    include: {
      client: { select: { id: true, firstName: true, lastName: true } },
      invitedBy: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  })
  return invitations.map((inv) => ({ ...inv, displayStatus: computeInvitationDisplayStatus(inv) }))
}

// ── Staff: list active/historical portal access grants for a client ──
export async function getClientPortalAccess(orgId: string, clientId: string) {
  await requireStaffManager(orgId)
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { organizationId: true } })
  if (!client || client.organizationId !== orgId) {
    throw new Error("Client not found")
  }
  return prisma.portalClientAccess.findMany({
    where: { organizationId: orgId, clientId },
    include: { portalUser: { select: { id: true, email: true, status: true, lastLoginAt: true } } },
    orderBy: { createdAt: "desc" },
  })
}

// ── Staff: lightweight client picker for the invitation form (no heavy includes) ──
export async function getClientsForPortalInvite(orgId: string) {
  await requireStaffManager(orgId)
  return prisma.client.findMany({
    where: { organizationId: orgId, archivedAt: null },
    select: {
      id: true, firstName: true, lastName: true,
      contacts: { where: { isGuardian: true }, select: { id: true, firstName: true, lastName: true, email: true, relationship: true } },
    },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
  })
}

// ── Staff: revoke an active access grant ──
export async function revokePortalAccess(accessId: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const access = await prisma.portalClientAccess.findUnique({ where: { id: accessId } })
    if (!access) return { success: false, error: "Access grant not found" }
    const authorization = await requireStaffManager(access.organizationId)
    const orgId = authorization.organizationId
    if (access.status !== "ACTIVE" || access.revokedAt) {
      return { success: false, error: "Access grant is not active" }
    }

    await prisma.portalClientAccess.update({
      where: { id: accessId },
      data: { status: "REVOKED", revokedAt: new Date(), revokedByUserId: authorization.userId, revocationReason: reason || null },
    })

    await createPortalAuditEvent({
      organizationId: orgId,
      clientId: access.clientId,
      portalUserId: access.portalUserId,
      action: "PORTAL_ACCESS_REVOKED",
      targetType: "portal_client_access",
      targetId: accessId,
      metadata: { reason: reason || null },
    })

    revalidatePath(`/clients/${access.clientId}/portal-access`)

    return { success: true, data: { id: accessId } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to revoke access" }
  }
}

// ── Public: safe, pre-activation invitation lookup ──
export type PortalInvitationLookup =
  | { status: "NOT_FOUND" }
  | { status: "EXPIRED" | "REVOKED" | "ACCEPTED" }
  | {
      status: "VALID"
      organizationName: string
      clientDisplayName: string
      invitedEmail: string
      accessRole: string
      relationship: string | null
      isExistingPortalUser: boolean
    }

const RAW_TOKEN_SHAPE = /^[a-f0-9]{64}$/

export async function getPortalInvitationByToken(rawToken: string): Promise<PortalInvitationLookup> {
  const ip = await getRequestIp()
  const limited = limiters.portalInvitationView.check(ip)
  if (!limited.allowed) return { status: "NOT_FOUND" }

  if (typeof rawToken !== "string" || !RAW_TOKEN_SHAPE.test(rawToken)) {
    return { status: "NOT_FOUND" }
  }

  const hash = hashPortalToken(rawToken)
  const invitation = await prisma.portalInvitation.findUnique({
    where: { tokenHash: hash },
    include: { organization: { select: { name: true } }, client: { select: { firstName: true, lastName: true } } },
  })
  if (!invitation) return { status: "NOT_FOUND" }

  const displayStatus = computeInvitationDisplayStatus(invitation)
  if (displayStatus !== "PENDING") return { status: displayStatus }

  const existingPortalUser = await prisma.portalUser.findUnique({ where: { email: invitation.invitedEmail }, select: { id: true } })

  return {
    status: "VALID",
    organizationName: invitation.organization.name,
    clientDisplayName: `${invitation.client.firstName} ${invitation.client.lastName.charAt(0)}.`,
    invitedEmail: invitation.invitedEmail,
    accessRole: invitation.accessRole,
    relationship: invitation.relationship,
    isExistingPortalUser: !!existingPortalUser,
  }
}

// ── Public: accept invitation + create/link portal account + grant access ──
class PortalActivationConflict extends Error {}

export async function activatePortalAccount(raw: Record<string, unknown>): Promise<ActionResult<{ activated: true }>> {
  const parsed = validate(activatePortalAccountSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const { token: rawToken, password } = parsed.data

  const ip = await getRequestIp()
  const limited = limiters.portalActivation.check(ip)
  if (!limited.allowed) {
    return { success: false, error: `Too many attempts. Try again in ${limited.retryAfter} seconds.` }
  }

  if (!RAW_TOKEN_SHAPE.test(rawToken)) {
    return { success: false, error: "This invitation link is invalid." }
  }
  const hash = hashPortalToken(rawToken)

  try {
    await prisma.$transaction(async (tx) => {
      const invitation = await tx.portalInvitation.findUnique({ where: { tokenHash: hash } })
      if (!invitation) throw new PortalActivationConflict("This invitation link is invalid.")

      const displayStatus = computeInvitationDisplayStatus(invitation)
      if (displayStatus !== "PENDING") {
        throw new PortalActivationConflict(
          displayStatus === "EXPIRED" ? "This invitation has expired." :
          displayStatus === "REVOKED" ? "This invitation has been revoked." :
          "This invitation has already been used."
        )
      }

      const existingPortalUser = await tx.portalUser.findUnique({ where: { email: invitation.invitedEmail } })
      let portalUserId: string
      let didVerifyEmail = false

      if (existingPortalUser) {
        if (existingPortalUser.status === "SUSPENDED" || existingPortalUser.status === "LOCKED" || existingPortalUser.status === "DEACTIVATED") {
          throw new PortalActivationConflict("This account cannot accept new invitations right now.")
        }
        if (!existingPortalUser.passwordHash || !(await bcrypt.compare(password, existingPortalUser.passwordHash))) {
          throw new PortalActivationConflict("Incorrect password for the existing account with this email.")
        }
        portalUserId = existingPortalUser.id
        const needsFinalize = existingPortalUser.status === "PENDING_VERIFICATION" || !existingPortalUser.emailVerifiedAt
        if (needsFinalize) {
          didVerifyEmail = !existingPortalUser.emailVerifiedAt
          await tx.portalUser.update({
            where: { id: portalUserId },
            data: { status: "ACTIVE" as PortalUserStatus, emailVerifiedAt: existingPortalUser.emailVerifiedAt ?? new Date() },
          })
        }
      } else {
        didVerifyEmail = true
        const passwordHash = await bcrypt.hash(password, 12)
        // Created with the schema default (PENDING_VERIFICATION) first, then
        // explicitly transitioned to ACTIVE in a second write — there is no
        // real email-sending yet, so possession of the invitation link
        // itself (delivered out-of-band by staff) stands in for the
        // verification step, but the PENDING_VERIFICATION state is never
        // skipped over.
        const created = await tx.portalUser.create({
          data: { email: invitation.invitedEmail, passwordHash },
        })
        await tx.portalUser.update({
          where: { id: created.id },
          data: { status: "ACTIVE" as PortalUserStatus, emailVerifiedAt: new Date() },
        })
        portalUserId = created.id
      }

      // Conditional update prevents double-acceptance: only succeeds if the
      // invitation is still exactly in the state we just read (no concurrent
      // accept/revoke happened between the read above and this write).
      const acceptResult = await tx.portalInvitation.updateMany({
        where: { id: invitation.id, status: "PENDING", acceptedAt: null, revokedAt: null },
        data: { status: "ACCEPTED", acceptedAt: new Date(), acceptedByPortalUserId: portalUserId },
      })
      if (acceptResult.count !== 1) {
        throw new PortalActivationConflict("This invitation has already been used.")
      }

      const permissions = deriveGrantPermissions(invitation.requestedPermissions)

      await tx.portalClientAccess.create({
        data: {
          portalUserId,
          clientId: invitation.clientId,
          organizationId: invitation.organizationId,
          clientContactId: invitation.clientContactId,
          relationship: invitation.relationship || "Not specified",
          accessRole: invitation.accessRole,
          status: "ACTIVE",
          grantedByUserId: invitation.invitedByUserId,
          ...permissions,
        },
      })

      await createPortalAuditEvent({
        organizationId: invitation.organizationId,
        clientId: invitation.clientId,
        portalUserId,
        action: "PORTAL_INVITATION_ACCEPTED",
        targetType: "portal_invitation",
        targetId: invitation.id,
      }, tx)
      await createPortalAuditEvent({
        organizationId: invitation.organizationId,
        clientId: invitation.clientId,
        portalUserId,
        action: "PORTAL_ACCESS_GRANTED",
        targetType: "portal_client_access",
      }, tx)
      if (didVerifyEmail) {
        await createPortalAuditEvent({
          organizationId: invitation.organizationId,
          portalUserId,
          action: "PORTAL_EMAIL_VERIFIED",
        }, tx)
      }
    })

    return { success: true, data: { activated: true } }
  } catch (error) {
    if (error instanceof PortalActivationConflict) {
      return { success: false, error: error.message }
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { success: false, error: "This person already has active access to this client, or an account with this email already exists." }
    }
    return { success: false, error: "Something went wrong activating this account. Please try again." }
  }
}
