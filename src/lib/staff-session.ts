import "server-only"

import { prisma } from "./db"

export interface RefreshableStaffToken extends Record<string, unknown> {
  id?: unknown
  activeOrganizationId?: unknown
  staffSessionVersion?: unknown
}

/**
 * Revalidates a JWT-backed staff session against the database on every access.
 * A version mismatch, deleted user, or non-Super-Admin with no active
 * memberships invalidates the JWT immediately. Authorization still happens
 * separately against each target resource.
 */
export async function refreshStaffSessionToken(
  token: RefreshableStaffToken,
  signingIn = false,
): Promise<RefreshableStaffToken | null> {
  const userId = typeof token.id === "string" ? token.id : null
  if (!userId) return null

  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      isSuperAdmin: true,
      sessionVersion: true,
      memberships: {
        where: { status: "ACTIVE" },
        select: {
          id: true,
          organizationId: true,
          role: true,
          organization: { select: { name: true, slug: true } },
        },
      },
    },
  })
  if (!user) return null

  const tokenVersion = typeof token.staffSessionVersion === "number" ? token.staffSessionVersion : 0
  if (!signingIn && tokenVersion !== user.sessionVersion) return null
  if (!user.isSuperAdmin && user.memberships.length === 0) return null

  const selectedOrganizationId = typeof token.activeOrganizationId === "string" ? token.activeOrganizationId : null
  const selectedStillActive = user.memberships.some((membership) => membership.organizationId === selectedOrganizationId)

  return {
    ...token,
    isSuperAdmin: user.isSuperAdmin,
    staffSessionVersion: user.sessionVersion,
    activeOrganizationId: user.isSuperAdmin || selectedStillActive
      ? selectedOrganizationId ?? undefined
      : user.memberships[0]?.organizationId,
    memberships: user.memberships.map((membership) => ({
      id: membership.id,
      organizationId: membership.organizationId,
      organizationName: membership.organization.name,
      organizationSlug: membership.organization.slug,
      role: membership.role,
    })),
  }
}

export async function incrementStaffSessionVersion(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } })
}
