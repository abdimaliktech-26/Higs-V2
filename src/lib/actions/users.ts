"use server"

import { revalidatePath } from "next/cache"
import { validate, createUserSchema, orgSettingsSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import {
  getLiveStaffAuthorizationContext,
  requireActiveOrganizationMembership,
  requireOrganizationRole,
} from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"
import { UserRole, MemberStatus } from "@prisma/client"
import bcrypt from "bcryptjs"

const MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

async function requireSelectedManagedOrganization(reason: string) {
  const identity = await getLiveStaffAuthorizationContext()
  if (!identity.selectedOrganizationId) throw new Error("Select an organization")
  return requireOrganizationRole(identity.selectedOrganizationId, MANAGE_ROLES, reason)
}

export async function getOrgUsers(orgId: string) {
  await requireOrganizationRole(orgId, MANAGE_ROLES, "list organization users")
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
    const authorization = await requireSelectedManagedOrganization("create organization user")
    const orgId = authorization.organizationId

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
      organizationId: orgId, actorId: authorization.userId,
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
    const member = await prisma.organizationMember.findUnique({ where: { id: memberId }, include: { user: true } })
    if (!member) return { success: false, error: "Not found" }
    const authorization = await requireOrganizationRole(member.organizationId, MANAGE_ROLES, "update organization user")

    if (data.name) {
      await prisma.user.update({ where: { id: member.userId }, data: { name: data.name } })
    }
    if (data.role) {
      await prisma.organizationMember.update({ where: { id: memberId }, data: { role: data.role } })
      await createAuditEvent({
        organizationId: member.organizationId, actorId: authorization.userId,
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

    if (data.name || data.status || data.departments) {
      await createAuditEvent({
        organizationId: member.organizationId,
        actorId: authorization.userId,
        action: "USER_UPDATED",
        targetType: "user",
        targetId: member.userId,
        metadata: { fields: [data.name ? "name" : null, data.status ? "status" : null, data.departments ? "departments" : null].filter(Boolean) },
      })
    }

    revalidatePath("/settings/users")
    return { success: true, data: { id: memberId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getOrgSettings(orgId: string) {
  await requireActiveOrganizationMembership(orgId, "view organization settings")
  const org = await prisma.organization.findUnique({ where: { id: orgId } })
  return org
}

export async function updateOrgSettings(raw: Record<string, unknown>): Promise<ActionResult> {
  const parsed = validate(orgSettingsSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  try {
    const authorization = await requireSelectedManagedOrganization("update organization settings")
    const orgId = authorization.organizationId

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
      organizationId: orgId, actorId: authorization.userId,
      action: "SETTINGS_UPDATED", targetType: "organization", targetId: orgId,
      metadata: { changes: Object.keys(data).join(", ") },
    })

    revalidatePath("/settings/organization")
    return { success: true, data: { orgId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
