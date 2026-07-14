import { beforeEach, describe, expect, it, vi } from "vitest"

const clientCreate = vi.fn()
const clientFindUnique = vi.fn()
const staffAssignmentUpsert = vi.fn()
const getLiveStaffAuthorizationContext = vi.fn()
const requireOrganizationRole = vi.fn()
const requireActiveAssignableStaff = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    client: {
      create: (...args: unknown[]) => clientCreate(...args),
      findUnique: (...args: unknown[]) => clientFindUnique(...args),
    },
    staffAssignment: { upsert: (...args: unknown[]) => staffAssignmentUpsert(...args) },
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  CLIENT_CREATION_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  CLIENT_ASSIGNMENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  getLiveStaffAuthorizationContext: (...args: unknown[]) => getLiveStaffAuthorizationContext(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireActiveAssignableStaff: (...args: unknown[]) => requireActiveAssignableStaff(...args),
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
  clientCreate.mockResolvedValue({ id: "client-1", firstName: "Ayaan", lastName: "Mohamed" })
  clientFindUnique.mockResolvedValue({ id: "client-1", organizationId: ORG_ID })
  staffAssignmentUpsert.mockResolvedValue({})
  createAuditEvent.mockResolvedValue(undefined)
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
