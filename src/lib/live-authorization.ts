import "server-only"

import { auth } from "./auth"
import { createAuditEvent } from "./audit"
import { prisma } from "./db"
import type { UserRole } from "@prisma/client"

export const ORGANIZATION_WIDE_CLIENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
export const ASSIGNMENT_SCOPED_CLIENT_ROLES: readonly UserRole[] = ["CASE_MANAGER", "DSP", "NURSE"]
export const CLIENT_READ_ROLES: readonly UserRole[] = [...ORGANIZATION_WIDE_CLIENT_ROLES, ...ASSIGNMENT_SCOPED_CLIENT_ROLES]
export const CLIENT_CREATION_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
export const PACKET_CREATION_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]
export const APPROVAL_SUBMISSION_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]
export const APPROVAL_DECISION_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
export const SIGNATURE_MANAGEMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]
export const CLIENT_ASSIGNMENT_ROLES: readonly UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

export class StaffAuthorizationError extends Error {
  constructor() {
    super("Access denied")
    this.name = "StaffAuthorizationError"
  }
}

export interface LiveStaffIdentity {
  userId: string
  email: string
  name: string | null
  isGlobalSuperAdmin: boolean
  selectedOrganizationId: string | null
}

export interface LiveOrganizationAuthorization extends LiveStaffIdentity {
  organizationId: string
  role: UserRole
  membershipId: string | null
  isCrossTenantSuperAdmin: boolean
}

export interface LiveResourceAuthorization extends LiveOrganizationAuthorization {
  clientId: string
  isAssignedToClient: boolean
}

export type ClientAccessCapability = "read" | "manage" | "archive" | "assign" | "packet:create"
export type PacketAccessCapability = "read" | "manage" | "approval:read" | "submit:approval" | "signature:manage"
export type DocumentAccessCapability = "read" | "write"

async function deny(userId?: string, organizationId?: string, reason = "live authorization denied"): Promise<never> {
  await createAuditEvent({
    action: "ACCESS_DENIED",
    actorId: userId ?? null,
    organizationId: organizationId ?? null,
    metadata: { reason },
  })
  throw new StaffAuthorizationError()
}

/** JWT claims are identity/selection hints only. User and privilege state are reloaded live. */
export async function getLiveStaffAuthorizationContext(): Promise<LiveStaffIdentity> {
  const session = await auth()
  const sessionUser = session?.user as Record<string, unknown> | undefined
  const userId = typeof sessionUser?.id === "string" ? sessionUser.id : null
  if (!userId) return deny()

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, isSuperAdmin: true },
  })
  if (!user) return deny(userId, undefined, "staff identity no longer exists")

  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    isGlobalSuperAdmin: user.isSuperAdmin,
    selectedOrganizationId: typeof sessionUser?.activeOrganizationId === "string" ? sessionUser.activeOrganizationId : null,
  }
}

async function resolveOrganizationAuthorization(
  identity: LiveStaffIdentity,
  organizationId: string,
  superAdminReason: string,
): Promise<LiveOrganizationAuthorization> {
  if (identity.isGlobalSuperAdmin) {
    if (!superAdminReason.trim()) return deny(identity.userId, organizationId, "global super admin reason missing")
    return {
      ...identity,
      organizationId,
      role: "SUPER_ADMIN",
      membershipId: null,
      isCrossTenantSuperAdmin: identity.selectedOrganizationId !== organizationId,
    }
  }

  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: identity.userId } },
    select: { id: true, role: true, status: true },
  })
  if (!membership || membership.status !== "ACTIVE") {
    return deny(identity.userId, organizationId, "active organization membership required")
  }

  return {
    ...identity,
    organizationId,
    role: membership.role,
    membershipId: membership.id,
    isCrossTenantSuperAdmin: false,
  }
}

export async function requireActiveOrganizationMembership(
  organizationId: string,
  superAdminReason: string,
): Promise<LiveOrganizationAuthorization> {
  const identity = await getLiveStaffAuthorizationContext()
  return resolveOrganizationAuthorization(identity, organizationId, superAdminReason)
}

export async function requireOrganizationRole(
  organizationId: string,
  allowedRoles: readonly UserRole[],
  superAdminReason: string,
): Promise<LiveOrganizationAuthorization> {
  const authorization = await requireActiveOrganizationMembership(organizationId, superAdminReason)
  if (!allowedRoles.includes(authorization.role)) return deny(authorization.userId, organizationId, "live role lacks required capability")
  return authorization
}

async function isCurrentlyAssigned(clientId: string, userId: string): Promise<boolean> {
  const now = new Date()
  const assignment = await prisma.staffAssignment.findFirst({
    where: {
      clientId,
      staffUserId: userId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    },
    select: { id: true },
  })
  return Boolean(assignment)
}

async function authorizeClient(
  identity: LiveStaffIdentity,
  organizationId: string,
  clientId: string,
  capability: ClientAccessCapability,
  superAdminReason: string,
): Promise<LiveResourceAuthorization> {
  const authorization = await resolveOrganizationAuthorization(identity, organizationId, superAdminReason)
  const organizationWide = ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role)
  const assignmentScoped = ASSIGNMENT_SCOPED_CLIENT_ROLES.includes(authorization.role)
  const assigned = organizationWide ? false : await isCurrentlyAssigned(clientId, authorization.userId)

  const allowed = capability === "read"
    ? organizationWide || (assignmentScoped && assigned)
    : capability === "packet:create"
      ? organizationWide || (authorization.role === "CASE_MANAGER" && assigned)
      : capability === "manage"
        ? organizationWide || (authorization.role === "CASE_MANAGER" && assigned)
      : organizationWide
  if (!allowed) return deny(authorization.userId, organizationId, "client capability denied")
  return { ...authorization, clientId, isAssignedToClient: assigned }
}

export async function requireClientAccess(
  clientId: string,
  capability: ClientAccessCapability,
  superAdminReason: string,
): Promise<LiveResourceAuthorization> {
  const identity = await getLiveStaffAuthorizationContext()
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { id: true, organizationId: true } })
  if (!client) return deny(identity.userId, undefined, "client unavailable")
  return authorizeClient(identity, client.organizationId, client.id, capability, superAdminReason)
}

export async function requirePacketAccess(
  packetId: string,
  capability: PacketAccessCapability,
  superAdminReason: string,
): Promise<LiveResourceAuthorization & { packetId: string }> {
  const identity = await getLiveStaffAuthorizationContext()
  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    select: { id: true, organizationId: true, clientId: true, client: { select: { organizationId: true } } },
  })
  if (!packet) return deny(identity.userId, undefined, "packet unavailable")
  if (packet.client.organizationId !== packet.organizationId) {
    return deny(identity.userId, packet.organizationId, "packet organization chain mismatch")
  }
  const clientCapability: ClientAccessCapability = capability === "read" || capability === "approval:read" ? "read" : "packet:create"
  const authorization = await authorizeClient(identity, packet.organizationId, packet.clientId, clientCapability, superAdminReason)
  if ((capability === "approval:read" || capability === "submit:approval") && !APPROVAL_SUBMISSION_ROLES.includes(authorization.role)) {
    return deny(authorization.userId, packet.organizationId, "approval submission capability denied")
  }
  if (capability === "signature:manage" && !SIGNATURE_MANAGEMENT_ROLES.includes(authorization.role)) {
    return deny(authorization.userId, packet.organizationId, "signature management capability denied")
  }
  return { ...authorization, packetId: packet.id }
}

export async function requireDocumentAccess(
  documentId: string,
  capability: DocumentAccessCapability,
  superAdminReason: string,
): Promise<LiveResourceAuthorization & { packetId: string; documentId: string }> {
  const identity = await getLiveStaffAuthorizationContext()
  const document = await prisma.packetDocument.findUnique({
    where: { id: documentId },
    select: {
      id: true,
      packet: {
        select: { id: true, organizationId: true, clientId: true, client: { select: { organizationId: true } } },
      },
    },
  })
  if (!document) return deny(identity.userId, undefined, "document unavailable")
  if (document.packet.client.organizationId !== document.packet.organizationId) {
    return deny(identity.userId, document.packet.organizationId, "document organization chain mismatch")
  }
  const authorization = await authorizeClient(identity, document.packet.organizationId, document.packet.clientId, "read", superAdminReason)
  if (capability === "write" && !["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"].includes(authorization.role)) {
    return deny(authorization.userId, document.packet.organizationId, "document write capability denied")
  }
  return { ...authorization, packetId: document.packet.id, documentId: document.id }
}

export async function requireActiveAssignableStaff(organizationId: string, staffUserId: string): Promise<void> {
  const membership = await prisma.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId, userId: staffUserId } },
    select: { status: true },
  })
  if (!membership || membership.status !== "ACTIVE") throw new StaffAuthorizationError()
}
