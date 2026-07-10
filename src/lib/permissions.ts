import { auth } from "./auth"
import { UserRole } from "@prisma/client"
import { createAuditEvent } from "./audit"

export type SessionUser = {
  id: string
  email: string
  name: string | null
  image: string | null
  isSuperAdmin: boolean
  activeOrganizationId?: string
  memberships: {
    id: string
    organizationId: string
    organizationName: string
    organizationSlug: string
    role: UserRole
  }[]
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const session = await auth()
  if (!session?.user) return null
  return session.user as unknown as SessionUser
}

export async function requireAuth(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) throw new Error("Unauthorized")
  return user
}

export async function requireOrgAccess(organizationId: string): Promise<SessionUser> {
  const user = await requireAuth()
  if (user.isSuperAdmin) return user
  const hasAccess = user.memberships?.some((m) => m.organizationId === organizationId)
  if (!hasAccess) {
    await createAuditEvent({
      action: "ACCESS_DENIED",
      actorId: user.id,
      organizationId,
      metadata: { reason: "not a member of this organization" },
    })
    throw new Error("Access denied")
  }
  return user
}

export async function requireRole(organizationId: string, allowedRoles: UserRole[]): Promise<SessionUser> {
  const user = await requireOrgAccess(organizationId)
  if (user.isSuperAdmin) return user
  const membership = user.memberships?.find((m) => m.organizationId === organizationId)
  if (!membership || !allowedRoles.includes(membership.role)) {
    await createAuditEvent({
      action: "ACCESS_DENIED",
      actorId: user.id,
      organizationId,
      metadata: { requiredRoles: allowedRoles, userRole: membership?.role },
    })
    throw new Error("Access denied")
  }
  return user
}

export function getActiveRole(user: SessionUser): UserRole {
  if (user.isSuperAdmin) return "SUPER_ADMIN" as UserRole
  const membership = user.memberships?.find((m) => m.organizationId === user.activeOrganizationId)
  return membership?.role ?? ("" as UserRole)
}

export function canAccessModule(role: UserRole, allowedRoles: UserRole[]): boolean {
  return allowedRoles.includes(role)
}

export function filterNavByRole<T extends { roles: UserRole[] }>(items: T[], role: UserRole, isSuperAdmin: boolean): T[] {
  return items.filter((item) => isSuperAdmin || item.roles.includes(role))
}


// Pure utility — testable without next-auth
