import { prisma } from "@/lib/db"
import { getPortalSessionFromCookie } from "@/lib/portal/session"

export class PortalAuthError extends Error {}

export interface PortalAuthContext {
  portalUserId: string
  email: string
  sessionId: string
}

/**
 * Every portal read must call this first. Re-verifies, on every request,
 * that: a live session cookie resolves to a PortalSession that is
 * unexpired/non-revoked (checked in getPortalSessionFromCookie), the
 * PortalUser is ACTIVE, and its email has been verified. Nothing here is
 * cached across requests — a revoked session or suspended account is
 * rejected on the very next call.
 */
export async function requirePortalAuth(): Promise<PortalAuthContext> {
  const session = await getPortalSessionFromCookie()
  if (!session) throw new PortalAuthError("Not signed in")

  const { portalUser } = session
  if (portalUser.status !== "ACTIVE") throw new PortalAuthError("Account is not active")
  if (!portalUser.emailVerifiedAt) throw new PortalAuthError("Email not verified")

  return { portalUserId: portalUser.id, email: portalUser.email, sessionId: session.id }
}

export interface PortalClientAccessContext extends PortalAuthContext {
  accessId: string
  organizationId: string
  accessRole: string
  relationship: string
  permissions: {
    canViewDocuments: boolean
    canUploadDocuments: boolean
    canSignDocuments: boolean
    canViewAppointments: boolean
    canMessageCareTeam: boolean
    canManageOtherGuardians: boolean
  }
}

/**
 * Never trust a clientId from the browser (query param, form field, or
 * client-switcher selection) beyond this check — every destination page and
 * every data read must call this independently, even if the client was
 * already "selected" earlier in the same session.
 */
export async function requirePortalClientAccess(clientId: string): Promise<PortalClientAccessContext> {
  const auth = await requirePortalAuth()

  const access = await prisma.portalClientAccess.findFirst({
    where: {
      portalUserId: auth.portalUserId,
      clientId,
      status: "ACTIVE",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  })
  if (!access) throw new PortalAuthError("No active access to this client")

  // Belt-and-suspenders: re-verify the grant's organizationId against the
  // client's actual current organizationId, rather than trusting the value
  // stored on the grant at creation time.
  const client = await prisma.client.findUnique({ where: { id: clientId }, select: { organizationId: true } })
  if (!client || client.organizationId !== access.organizationId) {
    throw new PortalAuthError("No active access to this client")
  }

  return {
    ...auth,
    accessId: access.id,
    organizationId: access.organizationId,
    accessRole: access.accessRole,
    relationship: access.relationship,
    permissions: {
      canViewDocuments: access.canViewDocuments,
      canUploadDocuments: access.canUploadDocuments,
      canSignDocuments: access.canSignDocuments,
      canViewAppointments: access.canViewAppointments,
      canMessageCareTeam: access.canMessageCareTeam,
      canManageOtherGuardians: access.canManageOtherGuardians,
    },
  }
}

export async function requirePortalPermission(
  clientId: string,
  permission: keyof PortalClientAccessContext["permissions"]
): Promise<PortalClientAccessContext> {
  const context = await requirePortalClientAccess(clientId)
  if (!context.permissions[permission]) {
    throw new PortalAuthError("This permission has not been granted")
  }
  return context
}
