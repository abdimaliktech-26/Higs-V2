import { beforeEach, describe, expect, it, vi } from "vitest"

const getLiveStaffAuthorizationContext = vi.fn()
const requireOrganizationRole = vi.fn()
const requireActiveOrganizationMembership = vi.fn()
const organizationMemberFindMany = vi.fn()
const organizationMemberFindUnique = vi.fn()
const organizationMemberCreate = vi.fn()
const organizationMemberUpdate = vi.fn()
const userFindUnique = vi.fn()
const userCreate = vi.fn()
const userUpdate = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: (...args: unknown[]) => getLiveStaffAuthorizationContext(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    organizationMember: {
      findMany: (...args: unknown[]) => organizationMemberFindMany(...args),
      findUnique: (...args: unknown[]) => organizationMemberFindUnique(...args),
      create: (...args: unknown[]) => organizationMemberCreate(...args),
      update: (...args: unknown[]) => organizationMemberUpdate(...args),
    },
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      create: (...args: unknown[]) => userCreate(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
    organization: { findUnique: vi.fn(), update: vi.fn() },
  },
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("bcryptjs", () => ({ default: { hash: vi.fn().mockResolvedValue("hashed-password") } }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const ACTOR_ID = "admin-1"
const MEMBER_ID = "member-1"
const TARGET_ID = "user-2"

beforeEach(() => {
  vi.clearAllMocks()
  getLiveStaffAuthorizationContext.mockResolvedValue({ userId: ACTOR_ID, selectedOrganizationId: ORG_ID })
  requireOrganizationRole.mockResolvedValue({ userId: ACTOR_ID, organizationId: ORG_ID, role: "ORG_ADMIN" })
  requireActiveOrganizationMembership.mockResolvedValue({ userId: ACTOR_ID, organizationId: ORG_ID, role: "ORG_ADMIN" })
  organizationMemberFindMany.mockResolvedValue([])
  organizationMemberFindUnique.mockResolvedValue({
    id: MEMBER_ID, organizationId: ORG_ID, userId: TARGET_ID, role: "CASE_MANAGER", status: "ACTIVE",
    user: { id: TARGET_ID, name: "Target User" },
  })
  organizationMemberUpdate.mockResolvedValue({})
  organizationMemberCreate.mockResolvedValue({})
  userFindUnique.mockResolvedValue(null)
  userCreate.mockResolvedValue({ id: TARGET_ID })
  userUpdate.mockResolvedValue({})
  createAuditEvent.mockResolvedValue(undefined)
})

describe("organization user administration uses live target-organization roles", () => {
  it("requires a live management role to list organization users", async () => {
    const { getOrgUsers } = await import("@/lib/actions/users")
    await getOrgUsers(ORG_ID)
    expect(requireOrganizationRole).toHaveBeenCalledWith(ORG_ID, ["SUPER_ADMIN", "ORG_ADMIN"], "list organization users")
  })

  it("uses the selected organization only as a target before a live role check for user creation", async () => {
    const { createOrgUser } = await import("@/lib/actions/users")
    const result = await createOrgUser({ email: "new@example.com", name: "New User", role: "DSP", password: "secret123" })
    expect(result.success).toBe(true)
    expect(requireOrganizationRole).toHaveBeenCalledWith(ORG_ID, ["SUPER_ADMIN", "ORG_ADMIN"], "create organization user")
    expect(organizationMemberCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG_ID, userId: TARGET_ID, status: "ACTIVE" }),
    })
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR_ID }))
  })

  it("derives role and status-change authorization from the target membership organization", async () => {
    const { updateOrgUser } = await import("@/lib/actions/users")
    const result = await updateOrgUser(MEMBER_ID, { status: "DISABLED" })
    expect(result.success).toBe(true)
    expect(requireOrganizationRole).toHaveBeenCalledWith(ORG_ID, ["SUPER_ADMIN", "ORG_ADMIN"], "update organization user")
    expect(organizationMemberUpdate).toHaveBeenCalledWith({ where: { id: MEMBER_ID }, data: { status: "DISABLED" } })
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: TARGET_ID }, data: { sessionVersion: { increment: 1 } } })
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ACTOR_ID,
      action: "USER_UPDATED",
      metadata: { fields: ["status"] },
    }))
  })

  it("supports an explicit audited session revocation", async () => {
    organizationMemberFindUnique.mockResolvedValue({ id: MEMBER_ID, organizationId: ORG_ID, userId: TARGET_ID })
    const { revokeOrgUserSessions } = await import("@/lib/actions/users")
    const result = await revokeOrgUserSessions(MEMBER_ID)
    expect(result.success).toBe(true)
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: TARGET_ID }, data: { sessionVersion: { increment: 1 } } })
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      actorId: ACTOR_ID,
      action: "USER_UPDATED",
      metadata: { fields: ["sessions"] },
    }))
  })

  it("does not write when the live target-organization role check fails", async () => {
    requireOrganizationRole.mockRejectedValue(new Error("Access denied"))
    const { updateOrgUser } = await import("@/lib/actions/users")
    await expect(updateOrgUser(MEMBER_ID, { role: "ORG_ADMIN" })).resolves.toEqual({ success: false, error: "Access denied" })
    expect(organizationMemberUpdate).not.toHaveBeenCalled()
  })
})
