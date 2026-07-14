import { describe, it, expect, vi, beforeEach } from "vitest"

const findManyMock = vi.fn().mockResolvedValue([])
const countMock = vi.fn().mockResolvedValue(0)
const findUniqueMock = vi.fn()
const findFirstMock = vi.fn()
const packetFindManyMock = vi.fn()
const requireActiveOrganizationMembershipMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    auditEvent: {
      findMany: (...args: unknown[]) => findManyMock(...args),
      count: (...args: unknown[]) => countMock(...args),
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
      findFirst: (...args: unknown[]) => findFirstMock(...args),
    },
    packet: { findMany: (...args: unknown[]) => packetFindManyMock(...args) },
  },
}))

vi.mock("@/lib/live-authorization", () => ({
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembershipMock(...args),
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
    findUniqueMock.mockReset()
    findFirstMock.mockReset()
    packetFindManyMock.mockResolvedValue([])
    requireActiveOrganizationMembershipMock.mockReset()
    requireActiveOrganizationMembershipMock.mockResolvedValue({ userId: "user-1", organizationId: ORG_ID, role: "SUPER_ADMIN" })
  })

  it("empty audit search omits the OR clause entirely", async () => {
    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.OR).toBeUndefined()
  })

  it("exact valid AuditAction search matches the enum by equality, not contains", async () => {
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
    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "north star packet" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.OR).toEqual([
      { targetType: { contains: "north star packet", mode: "insensitive" } },
      { targetId: { contains: "north star packet", mode: "insensitive" } },
    ])
  })

  it("tenant scoping remains enforced for non-view-all roles regardless of search", async () => {
    requireActiveOrganizationMembershipMock.mockResolvedValue({ userId: "user-1", organizationId: ORG_ID, role: "CASE_MANAGER" })

    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { search: "client viewed" })

    const where = findManyMock.mock.calls[0][0].where
    expect(where.organizationId).toBe(ORG_ID)
    expect(where.actorId).toBe("user-1")
    expect(where.OR).toContainEqual({ action: "CLIENT_VIEWED" })
  })

  it("does not let an assignment-scoped actor override their own actor filter", async () => {
    requireActiveOrganizationMembershipMock.mockResolvedValue({ userId: "user-1", organizationId: ORG_ID, role: "CASE_MANAGER" })
    const { getAuditEvents } = await import("@/lib/actions/audit")
    await getAuditEvents(ORG_ID, { actorId: "another-user" })
    expect(findManyMock.mock.calls[0][0].where.actorId).toBe("user-1")
  })
})

describe("audit detail and dashboard resource scope", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    findManyMock.mockResolvedValue([])
    countMock.mockResolvedValue(0)
    packetFindManyMock.mockResolvedValue([])
    requireActiveOrganizationMembershipMock.mockResolvedValue({ userId: "user-1", organizationId: ORG_ID, role: "CASE_MANAGER" })
  })

  it("hides another actor's audit event from a Case Manager", async () => {
    findUniqueMock.mockResolvedValue({ organizationId: ORG_ID, actorId: "other-user" })
    const { getAuditEventDetail } = await import("@/lib/actions/audit")
    await expect(getAuditEventDetail("event-1")).resolves.toBeNull()
    expect(findUniqueMock).toHaveBeenCalledTimes(1)
  })

  it("limits dashboard packet aggregates to currently assigned clients", async () => {
    const { getAuditDashboardSummary } = await import("@/lib/actions/audit")
    await getAuditDashboardSummary(ORG_ID)
    const where = packetFindManyMock.mock.calls[0][0].where
    expect(where.client.assignments.some.staffUserId).toBe("user-1")
    expect(where.client.assignments.some.AND).toHaveLength(2)
  })
})
