import { beforeEach, describe, expect, it, vi } from "vitest"

const userFindUnique = vi.fn()
const userUpdate = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    user: {
      findUnique: (...args: unknown[]) => userFindUnique(...args),
      update: (...args: unknown[]) => userUpdate(...args),
    },
  },
}))

const USER_ID = "staff-1"
const ORG_ID = "org-1"

function liveUser(overrides: Record<string, unknown> = {}) {
  return {
    id: USER_ID,
    isSuperAdmin: false,
    sessionVersion: 3,
    memberships: [{
      id: "member-1", organizationId: ORG_ID, role: "CASE_MANAGER",
      organization: { name: "Higsi", slug: "higsi" },
    }],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  userFindUnique.mockResolvedValue(liveUser())
  userUpdate.mockResolvedValue({})
})

describe("versioned staff JWT refresh", () => {
  it("refreshes live Super Admin and active-membership claims", async () => {
    userFindUnique.mockResolvedValue(liveUser({ isSuperAdmin: true }))
    const { refreshStaffSessionToken } = await import("@/lib/staff-session")
    const token = await refreshStaffSessionToken({ id: USER_ID, staffSessionVersion: 3, activeOrganizationId: ORG_ID })
    expect(token).toMatchObject({ isSuperAdmin: true, staffSessionVersion: 3, activeOrganizationId: ORG_ID })
    expect(token?.memberships).toEqual([expect.objectContaining({ organizationId: ORG_ID, role: "CASE_MANAGER" })])
  })

  it("invalidates a deleted user", async () => {
    userFindUnique.mockResolvedValue(null)
    const { refreshStaffSessionToken } = await import("@/lib/staff-session")
    await expect(refreshStaffSessionToken({ id: USER_ID, staffSessionVersion: 3 })).resolves.toBeNull()
  })

  it("invalidates every older JWT after a session-version increment", async () => {
    const { refreshStaffSessionToken } = await import("@/lib/staff-session")
    await expect(refreshStaffSessionToken({ id: USER_ID, staffSessionVersion: 2 })).resolves.toBeNull()
  })

  it("accepts a newly issued token at the current live version", async () => {
    const { refreshStaffSessionToken } = await import("@/lib/staff-session")
    const token = await refreshStaffSessionToken({ id: USER_ID, staffSessionVersion: 0 }, true)
    expect(token?.staffSessionVersion).toBe(3)
  })

  it("invalidates non-Super-Admin staff with no active memberships", async () => {
    userFindUnique.mockResolvedValue(liveUser({ memberships: [] }))
    const { refreshStaffSessionToken } = await import("@/lib/staff-session")
    await expect(refreshStaffSessionToken({ id: USER_ID, staffSessionVersion: 3 })).resolves.toBeNull()
  })

  it("moves a stale organization selection to a remaining active membership", async () => {
    const { refreshStaffSessionToken } = await import("@/lib/staff-session")
    const token = await refreshStaffSessionToken({ id: USER_ID, staffSessionVersion: 3, activeOrganizationId: "removed-org" })
    expect(token?.activeOrganizationId).toBe(ORG_ID)
  })

  it("increments the revocation version without storing a session token", async () => {
    const { incrementStaffSessionVersion } = await import("@/lib/staff-session")
    await incrementStaffSessionVersion(USER_ID)
    expect(userUpdate).toHaveBeenCalledWith({ where: { id: USER_ID }, data: { sessionVersion: { increment: 1 } } })
  })
})
