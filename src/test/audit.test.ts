import { describe, it, expect, vi, beforeEach } from "vitest"

const findManyMock = vi.fn().mockResolvedValue([])
const countMock = vi.fn().mockResolvedValue(0)
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    auditEvent: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
    },
  },
}))

vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...args: unknown[]) => requireOrgAccessMock(...args),
  getActiveRole: (...args: unknown[]) => getActiveRoleMock(...args),
}))

vi.mock("@/lib/auth", () => ({
  auth: vi.fn(),
}))

vi.mock("@/lib/validation", () => ({
  validate: vi.fn(),
  auditQuerySchema: {},
}))

const ORG_ID = "org-1"

describe("getAuditEvents — search filter", () => {
  beforeEach(() => {
    findManyMock.mockClear()
    countMock.mockClear()
    requireOrgAccessMock.mockReset()
    getActiveRoleMock.mockReset()
  })

  it("empty audit search omits the OR clause entirely", async () => {
    requireOrgAccessMock.mockResolvedValue({ id: "user-1", isSuperAdmin: true, memberships: [] })
    getActiveRoleMock.mockReturnValue("SUPER_ADMIN")

    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.OR).toBeUndefined()
  })

  it("exact valid AuditAction search matches the enum by equality, not contains", async () => {
    requireOrgAccessMock.mockResolvedValue({ id: "user-1", isSuperAdmin: true, memberships: [] })
    getActiveRoleMock.mockReturnValue("SUPER_ADMIN")

    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "client viewed" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.OR).toContainEqual({ action: "CLIENT_VIEWED" })
    for (const clause of where.OR) {
      if ("action" in clause) {
        expect(clause.action).not.toHaveProperty("contains")
      }
    }
  })

  it("free-text search that is not a valid enum falls back to text-field conditions only", async () => {
    requireOrgAccessMock.mockResolvedValue({ id: "user-1", isSuperAdmin: true, memberships: [] })
    getActiveRoleMock.mockReturnValue("SUPER_ADMIN")

    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "north star packet" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { targetType: { contains: "north star packet", mode: "insensitive" } },
      { targetId: { contains: "north star packet", mode: "insensitive" } },
    ])
  })

  it("tenant scoping remains enforced for non-view-all roles regardless of search", async () => {
    requireOrgAccessMock.mockResolvedValue({ id: "user-1", isSuperAdmin: false, memberships: [] })
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")

    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "client viewed" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.organizationId).toBe(ORG_ID)
    expect(where.actorId).toBe("user-1")
    expect(where.OR).toContainEqual({ action: "CLIENT_VIEWED" })
  })
})
