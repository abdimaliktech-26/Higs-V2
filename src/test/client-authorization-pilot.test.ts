import { beforeEach, describe, expect, it, vi } from "vitest"

const clientCreate = vi.fn()
const clientFindUnique = vi.fn()
const clientFindMany = vi.fn()
const clientCount = vi.fn()
const clientUpdate = vi.fn()
const programFindMany = vi.fn()
const organizationMemberFindMany = vi.fn()
const staffAssignmentUpsert = vi.fn()
const getLiveStaffAuthorizationContext = vi.fn()
const requireOrganizationRole = vi.fn()
const requireActiveAssignableStaff = vi.fn()
const requireClientAccess = vi.fn()
const requireActiveOrganizationMembership = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    client: {
      create: (...args: unknown[]) => clientCreate(...args),
      findUnique: (...args: unknown[]) => clientFindUnique(...args),
      findMany: (...args: unknown[]) => clientFindMany(...args),
      count: (...args: unknown[]) => clientCount(...args),
      update: (...args: unknown[]) => clientUpdate(...args),
    },
    staffAssignment: { upsert: (...args: unknown[]) => staffAssignmentUpsert(...args) },
    program: { findMany: (...args: unknown[]) => programFindMany(...args) },
    organizationMember: { findMany: (...args: unknown[]) => organizationMemberFindMany(...args) },
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  CLIENT_CREATION_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  CLIENT_ASSIGNMENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  CLIENT_READ_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"],
  ASSIGNMENT_SCOPED_CLIENT_ROLES: ["CASE_MANAGER", "DSP", "NURSE"],
  getLiveStaffAuthorizationContext: (...args: unknown[]) => getLiveStaffAuthorizationContext(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireActiveAssignableStaff: (...args: unknown[]) => requireActiveAssignableStaff(...args),
  requireClientAccess: (...args: unknown[]) => requireClientAccess(...args),
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions", () => ({ requireOrgAccess: vi.fn(), getActiveRole: vi.fn() }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const ACTOR_ID = "admin-1"

beforeEach(() => {
  vi.clearAllMocks()
  getLiveStaffAuthorizationContext.mockResolvedValue({ userId: ACTOR_ID, selectedOrganizationId: ORG_ID })
  requireOrganizationRole.mockResolvedValue({ userId: ACTOR_ID, organizationId: ORG_ID, role: "ORG_ADMIN" })
  requireActiveAssignableStaff.mockResolvedValue(undefined)
  requireClientAccess.mockResolvedValue({ userId: ACTOR_ID, organizationId: ORG_ID, role: "ORG_ADMIN" })
  requireActiveOrganizationMembership.mockResolvedValue({ userId: ACTOR_ID, organizationId: ORG_ID, role: "ORG_ADMIN" })
  clientCreate.mockResolvedValue({ id: "client-1", firstName: "Ayaan", lastName: "Mohamed" })
  clientFindUnique.mockResolvedValue({ id: "client-1", organizationId: ORG_ID })
  clientFindMany.mockResolvedValue([])
  clientCount.mockResolvedValue(0)
  clientUpdate.mockResolvedValue({ id: "client-1", firstName: "Ayaan", lastName: "Mohamed" })
  programFindMany.mockResolvedValue([])
  organizationMemberFindMany.mockResolvedValue([])
  staffAssignmentUpsert.mockResolvedValue({})
  createAuditEvent.mockResolvedValue(undefined)
})

describe("remaining client actions use live authorization", () => {
  it("scopes a Case Manager client list to the live actor regardless of a requested manager filter", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "case-1", organizationId: ORG_ID, role: "CASE_MANAGER" })
    const { getClients } = await import("@/lib/actions/client")
    await getClients(ORG_ID, { caseManager: "someone-else" })
    expect(clientFindMany.mock.calls[0][0].where.assignments).toEqual({ some: { staffUserId: "case-1" } })
    expect(clientCount.mock.calls[0][0].where.assignments).toEqual({ some: { staffUserId: "case-1" } })
  })

  it("permits an organization-wide role to apply an explicit manager filter", async () => {
    const { getClients } = await import("@/lib/actions/client")
    await getClients(ORG_ID, { caseManager: "case-2" })
    expect(clientFindMany.mock.calls[0][0].where.assignments).toEqual({ some: { staffUserId: "case-2" } })
  })

  it("authorizes client detail through the target client before returning PHI", async () => {
    const { getClientById } = await import("@/lib/actions/client")
    await getClientById("client-1")
    expect(requireClientAccess).toHaveBeenCalledWith("client-1", "read", "view client details")
  })

  it("uses assigned-client manage capability for client updates", async () => {
    requireClientAccess.mockResolvedValue({ userId: "case-1", organizationId: ORG_ID, role: "CASE_MANAGER" })
    const { updateClient } = await import("@/lib/actions/client")
    const result = await updateClient("client-1", { firstName: "Updated" })
    expect(result.success).toBe(true)
    expect(requireClientAccess).toHaveBeenCalledWith("client-1", "manage", "update client")
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: "case-1" }))
  })

  it("requires organization-wide archive capability", async () => {
    const { archiveClient } = await import("@/lib/actions/client")
    const result = await archiveClient("client-1", "duplicate")
    expect(result.success).toBe(true)
    expect(requireClientAccess).toHaveBeenCalledWith("client-1", "archive", "archive client")
  })

  it("does not update or archive when live access has been revoked", async () => {
    requireClientAccess.mockRejectedValue(new Error("Access denied"))
    const { updateClient, archiveClient } = await import("@/lib/actions/client")
    await expect(updateClient("client-1", { firstName: "Updated" })).resolves.toEqual({ success: false, error: "Access denied" })
    await expect(archiveClient("client-1")).resolves.toEqual({ success: false, error: "Access denied" })
    expect(clientUpdate).not.toHaveBeenCalled()
  })

  it("requires a live administrative role before listing assignable staff", async () => {
    const { getAvailableStaff } = await import("@/lib/actions/client")
    await getAvailableStaff(ORG_ID)
    expect(requireOrganizationRole).toHaveBeenCalledWith(
      ORG_ID,
      ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
      "list staff available for client assignment",
    )
  })
})

describe("client creation and staff-assignment pilot actions", () => {
  it("checks the restrictive live role allowlist before creating a client", async () => {
    const { createClient } = await import("@/lib/actions/client")
    const result = await createClient({ firstName: "Ayaan", lastName: "Mohamed" })
    expect(result.success).toBe(true)
    expect(requireOrganizationRole).toHaveBeenCalledWith(
      ORG_ID,
      ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
      "create client in selected organization",
    )
    expect(clientCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ organizationId: ORG_ID }) })
  })

  it("does not create a client when the live role is denied", async () => {
    requireOrganizationRole.mockRejectedValue(new Error("Access denied"))
    const { createClient } = await import("@/lib/actions/client")
    await expect(createClient({ firstName: "Ayaan", lastName: "Mohamed" })).resolves.toEqual({ success: false, error: "Access denied" })
    expect(clientCreate).not.toHaveBeenCalled()
  })

  it("uses the live selected organization only as the new-client target", async () => {
    getLiveStaffAuthorizationContext.mockResolvedValue({ userId: ACTOR_ID, selectedOrganizationId: null })
    const { createClient } = await import("@/lib/actions/client")
    await expect(createClient({ firstName: "Ayaan", lastName: "Mohamed" })).resolves.toEqual({ success: false, error: "No organization selected" })
    expect(requireOrganizationRole).not.toHaveBeenCalled()
  })

  it("derives assignment authorization from the target client's organization", async () => {
    const { assignStaff } = await import("@/lib/actions/client")
    const result = await assignStaff("client-1", "staff-1", "case_manager", true)
    expect(result.success).toBe(true)
    expect(requireOrganizationRole).toHaveBeenCalledWith(
      ORG_ID,
      ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
      "assign staff to client",
    )
    expect(requireActiveAssignableStaff).toHaveBeenCalledWith(ORG_ID, "staff-1")
  })

  it("rejects an inactive or foreign assignee before persisting", async () => {
    requireActiveAssignableStaff.mockRejectedValue(new Error("Access denied"))
    const { assignStaff } = await import("@/lib/actions/client")
    await expect(assignStaff("client-1", "staff-1", "nurse", false)).resolves.toEqual({ success: false, error: "Access denied" })
    expect(staffAssignmentUpsert).not.toHaveBeenCalled()
  })

  it("does not assign staff when the acting role is denied", async () => {
    requireOrganizationRole.mockRejectedValue(new Error("Access denied"))
    const { assignStaff } = await import("@/lib/actions/client")
    await expect(assignStaff("client-1", "staff-1", "dsp", false)).resolves.toEqual({ success: false, error: "Access denied" })
    expect(requireActiveAssignableStaff).not.toHaveBeenCalled()
    expect(staffAssignmentUpsert).not.toHaveBeenCalled()
  })
})
