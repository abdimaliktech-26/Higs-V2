"use server"

import { revalidatePath } from "next/cache"
import { validate, createUserSchema, orgSettingsSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole, MemberStatus } from "@prisma/client"
import bcrypt from "bcryptjs"

const MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function getOrgUsers(orgId: string) {
  await requireOrgAccess(orgId)
  return prisma.organizationMember.findMany({
    where: { organizationId: orgId },
    include: { user: { select: { id: true, name: true, email: true, image: true, createdAt: true } } },
    orderBy: [{ role: "asc" }, { user: { name: "asc" } }],
  })
}

export async function createOrgUser(raw: Record<string, unknown>): Promise<ActionResult> {
  const parsed = validate(createUserSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const orgId = user.activeOrganizationId as string
    await requireOrgAccess(orgId)
    const role = getActiveRole(user as any)
    if (!MANAGE_ROLES.includes(role) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const pw = data.password || "changeme123"
    const passwordHash = await bcrypt.hash(pw, 12)

    const existingUser = await prisma.user.findUnique({ where: { email: data.email } })
    let userId: string

    if (existingUser) {
      userId = existingUser.id
      const existingMember = await prisma.organizationMember.findUnique({
        where: { organizationId_userId: { organizationId: orgId, userId } },
      })
      if (existingMember) return { success: false, error: "User is already a member of this organization" }
    } else {
      const newUser = await prisma.user.create({
        data: { email: data.email, name: data.name, passwordHash },
      })
      userId = newUser.id
    }

    await prisma.organizationMember.create({
      data: { organizationId: orgId, userId, role: data.role, status: MemberStatus.ACTIVE, departments: data.departments || [] },
    })

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string,
      action: "USER_CREATED", targetType: "user", targetId: userId,
      metadata: { userName: data.name, role: data.role },
    })

    revalidatePath("/settings/users")
    return { success: true, data: { id: userId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateOrgUser(memberId: string, data: { name?: string; role?: UserRole; status?: MemberStatus; departments?: string[] }): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>

    const member = await prisma.organizationMember.findUnique({ where: { id: memberId }, include: { user: true } })
    if (!member) return { success: false, error: "Not found" }
    await requireOrgAccess(member.organizationId)

    const role = getActiveRole(user as any)
    if (!MANAGE_ROLES.includes(role) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    if (data.name) {
      await prisma.user.update({ where: { id: member.userId }, data: { name: data.name } })
    }
    if (data.role) {
      await prisma.organizationMember.update({ where: { id: memberId }, data: { role: data.role } })
      await createAuditEvent({
        organizationId: member.organizationId, actorId: user.id as string,
        action: "ROLE_CHANGED", targetType: "user", targetId: member.userId,
        metadata: { fromRole: member.role, toRole: data.role, userName: member.user.name },
      })
    }
    if (data.status) {
      await prisma.organizationMember.update({ where: { id: memberId }, data: { status: data.status } })
    }
    if (data.departments) {
      await prisma.organizationMember.update({ where: { id: memberId }, data: { departments: data.departments } })
    }

    revalidatePath("/settings/users")
    return { success: true, data: { id: memberId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getOrgSettings(orgId: string) {
  await requireOrgAccess(orgId)
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  return org
}

export async function updateOrgSettings(raw: Record<string, unknown>): Promise<ActionResult> {
  const parsed = validate(orgSettingsSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const orgId = user.activeOrganizationId as string
    await requireOrgAccess(orgId)
    const role = getActiveRole(user as any)
    if (!MANAGE_ROLES.includes(role) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const current = await prisma.organization.findUnique({ where: { id: orgId } })
    const settings = (current?.settings as Record<string, unknown>) || {}

    const update: Record<string, unknown> = {}
    if (data.name) update.name = data.name
    if (data.timezone) update.settings = { ...settings, timezone: data.timezone }
    if (data.departments) update.settings = { ...(update.settings as object || settings), departments: data.departments }
    if (data.locations) update.settings = { ...(update.settings as object || settings), locations: data.locations }
    if (data.defaultPacketType) update.settings = { ...(update.settings as object || settings), defaultPacketType: data.defaultPacketType }
    if (data.mfaEnabled !== undefined) update.settings = { ...(update.settings as object || settings), mfaEnabled: data.mfaEnabled }
    if (data.ssoEnabled !== undefined) update.settings = { ...(update.settings as object || settings), ssoEnabled: data.ssoEnabled }

    await prisma.organization.update({ where: { id: orgId }, data: update as any })

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string,
      action: "SETTINGS_UPDATED", targetType: "organization", targetId: orgId,
      metadata: { changes: Object.keys(data).join(", ") },
    })

    revalidatePath("/settings/organization")
    return { success: true, data: { orgId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
