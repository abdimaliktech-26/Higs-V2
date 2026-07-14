import { beforeEach, describe, expect, it, vi } from "vitest"

const requireGlobalSuperAdmin = vi.fn()
const organizationFindMany = vi.fn()
const auditEventFindMany = vi.fn()
const aiExtractionCount = vi.fn()
const aiRecommendationCount = vi.fn()
const userCount = vi.fn()
const clientCount = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  requireGlobalSuperAdmin: (...args: unknown[]) => requireGlobalSuperAdmin(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    organization: { findMany: (...args: unknown[]) => organizationFindMany(...args) },
    auditEvent: { findMany: (...args: unknown[]) => auditEventFindMany(...args) },
    aiExtraction: { count: (...args: unknown[]) => aiExtractionCount(...args) },
    aiRecommendation: { count: (...args: unknown[]) => aiRecommendationCount(...args) },
    user: { count: (...args: unknown[]) => userCount(...args) },
    client: { count: (...args: unknown[]) => clientCount(...args) },
  },
}))

beforeEach(() => {
  vi.clearAllMocks()
  requireGlobalSuperAdmin.mockResolvedValue({ userId: "admin-1", isGlobalSuperAdmin: true })
  organizationFindMany.mockResolvedValue([])
  auditEventFindMany.mockResolvedValue([])
  aiExtractionCount.mockResolvedValue(0)
  aiRecommendationCount.mockResolvedValue(0)
  userCount.mockResolvedValue(0)
  clientCount.mockResolvedValue(0)
})

describe("platform reads use live global Super Admin authorization", () => {
  it("uses explicit operation reasons for every cross-tenant read", async () => {
    const data = await import("@/app/super-admin/super-admin-data")
    await data.getPlatformOrganizations()
    await data.getPlatformActivity()
    await data.getPlatformAiUsage()
    await data.getPlatformUserTotals()
    expect(requireGlobalSuperAdmin.mock.calls.map((call) => call[0])).toEqual([
      "view platform organizations",
      "view platform audit activity",
      "view platform AI usage",
      "view platform user totals",
    ])
  })

  it("does not query platform data when live Super Admin access is revoked", async () => {
    requireGlobalSuperAdmin.mockRejectedValue(new Error("Access denied"))
    const { getPlatformOrganizations } = await import("@/app/super-admin/super-admin-data")
    await expect(getPlatformOrganizations()).rejects.toThrow("Access denied")
    expect(organizationFindMany).not.toHaveBeenCalled()
  })
})
