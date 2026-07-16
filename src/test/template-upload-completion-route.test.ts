// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const requireRoleMock = vi.fn()
const findAttemptMock = vi.fn()
const completeMock = vi.fn()

vi.mock("@/lib/db", () => ({ prisma: { uploadAttempt: { findUnique: (...args: unknown[]) => findAttemptMock(...args) } } }))
vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: () => authMock(),
  requireOrganizationRole: (...args: unknown[]) => requireRoleMock(...args),
}))
vi.mock("@/lib/uploads/template-upload", () => ({
  completeTemplateUpload: (...args: unknown[]) => completeMock(...args),
  TemplateUploadUnavailableError: class TemplateUploadUnavailableError extends Error {},
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ATTEMPT = "cm42345678901234567890123"
const STAFF = "cm22345678901234567890123"
const ORG = "cm12345678901234567890123"

async function call(attemptId = ATTEMPT) {
  const { POST } = await import("@/app/api/uploads/[attemptId]/complete/route")
  const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ attemptId }) })
  return { response, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ userId: STAFF })
  findAttemptMock.mockResolvedValue({ id: ATTEMPT, organizationId: ORG, actorType: "STAFF", staffUserId: STAFF })
  requireRoleMock.mockResolvedValue({ userId: STAFF, organizationId: ORG, role: "ORG_ADMIN" })
  completeMock.mockResolvedValue({ attemptId: ATTEMPT, status: "COMPLETED", templateId: "template", version: 1 })
})

describe("template upload completion authorization", () => {
  it("completes only the original staff uploader's attempt with a live admin role", async () => {
    const { response, body } = await call()
    expect(response.status).toBe(200)
    expect(body.data.templateId).toBe("template")
    expect(requireRoleMock).toHaveBeenCalledWith(ORG, ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"], "complete document template upload")
    expect(completeMock).toHaveBeenCalledWith(ATTEMPT, STAFF)
  })

  it("hides another staff user's attempt", async () => {
    findAttemptMock.mockResolvedValue({ id: ATTEMPT, organizationId: ORG, actorType: "STAFF", staffUserId: "someone-else" })
    const { response } = await call()
    expect(response.status).toBe(404)
    expect(completeMock).not.toHaveBeenCalled()
  })

  it("rejects a role revoked while the scan was pending", async () => {
    requireRoleMock.mockRejectedValue(new Error("revoked"))
    const { response } = await call()
    expect(response.status).toBe(403)
    expect(completeMock).not.toHaveBeenCalled()
  })

  it("rejects malformed attempt identifiers without a database lookup", async () => {
    const { response } = await call("../other")
    expect(response.status).toBe(404)
    expect(findAttemptMock).not.toHaveBeenCalled()
  })
})
