// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const reportMock = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: () => authMock(),
}))
vi.mock("@/lib/uploads/reconciliation", () => ({
  generateUploadReconciliationReport: (...a: unknown[]) => reportMock(...a),
}))

async function call() {
  const { GET } = await import("@/app/api/admin/upload-reconciliation/route")
  const response = await GET()
  return { response, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ userId: "cm22345678901234567890123", isGlobalSuperAdmin: true })
  reportMock.mockResolvedValue([
    { category: "CLEANUP_PENDING", resourceType: "UPLOAD_ATTEMPT", resourceId: "cm42345678901234567890123", organizationId: "org" },
    { category: "CLEANUP_PENDING", resourceType: "UPLOAD_ATTEMPT", resourceId: "cm52345678901234567890123", organizationId: "org" },
  ])
})

describe("super-admin upload reconciliation report route", () => {
  it("returns the database-only report to a global super admin", async () => {
    const { response, body } = await call()
    expect(response.status).toBe(200)
    expect(body.data.total).toBe(2)
    expect(body.data.countsByCategory).toEqual({ CLEANUP_PENDING: 2 })
    expect(response.headers.get("Cache-Control")).toContain("no-store")
    // Read-only and database-only: the report runs with no probes argument.
    expect(reportMock).toHaveBeenCalledWith()
  })

  it("denies ordinary staff, including organization admins", async () => {
    authMock.mockResolvedValue({ userId: "cm22345678901234567890123", isGlobalSuperAdmin: false })
    const { response } = await call()
    expect(response.status).toBe(403)
    expect(reportMock).not.toHaveBeenCalled()
  })

  it("denies unauthenticated callers", async () => {
    authMock.mockRejectedValue(new Error("no session"))
    const { response } = await call()
    expect(response.status).toBe(401)
    expect(reportMock).not.toHaveBeenCalled()
  })
})
