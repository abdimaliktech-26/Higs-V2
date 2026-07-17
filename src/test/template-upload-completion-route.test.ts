// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const authMock = vi.fn()
const requireRoleMock = vi.fn()
const findAttemptMock = vi.fn()
const completeMock = vi.fn()
const completeSupportingMock = vi.fn()
const authorizeSupportingMock = vi.fn()

vi.mock("@/lib/db", () => ({ prisma: { uploadAttempt: { findUnique: (...args: unknown[]) => findAttemptMock(...args) } } }))
vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: () => authMock(),
  requireOrganizationRole: (...args: unknown[]) => requireRoleMock(...args),
}))
vi.mock("@/lib/uploads/template-upload", () => ({
  completeTemplateUpload: (...args: unknown[]) => completeMock(...args),
  TemplateUploadUnavailableError: class TemplateUploadUnavailableError extends Error {},
}))
vi.mock("@/lib/uploads/supporting-upload", () => ({
  completeStaffSupportingUpload: (...args: unknown[]) => completeSupportingMock(...args),
}))
vi.mock("@/lib/uploads/staff-supporting-authorization", () => ({
  authorizeStaffSupportingUpload: (...args: unknown[]) => authorizeSupportingMock(...args),
  SupportingUploadAuthorizationError: class SupportingUploadAuthorizationError extends Error {},
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ATTEMPT = "cm42345678901234567890123"
const STAFF = "cm22345678901234567890123"
const ORG = "cm12345678901234567890123"
const CLIENT = "cm32345678901234567890123"

async function call(attemptId = ATTEMPT) {
  const { POST } = await import("@/app/api/uploads/[attemptId]/complete/route")
  const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ attemptId }) })
  return { response, body: await response.json() }
}

function templateAttempt(overrides: Record<string, unknown> = {}) {
  return { id: ATTEMPT, organizationId: ORG, actorType: "STAFF", staffUserId: STAFF, uploadKind: "TEMPLATE", supportingIntent: null, ...overrides }
}

function supportingAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT,
    organizationId: ORG,
    actorType: "STAFF",
    staffUserId: STAFF,
    uploadKind: "STAFF_SUPPORTING",
    supportingIntent: { clientId: CLIENT, packetId: null },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ userId: STAFF })
  findAttemptMock.mockResolvedValue(templateAttempt())
  requireRoleMock.mockResolvedValue({ userId: STAFF, organizationId: ORG, role: "ORG_ADMIN" })
  completeMock.mockResolvedValue({ attemptId: ATTEMPT, status: "COMPLETED", templateId: "template", version: 1 })
  authorizeSupportingMock.mockResolvedValue({ userId: STAFF, organizationId: ORG, clientId: CLIENT })
  completeSupportingMock.mockResolvedValue({ attemptId: ATTEMPT, status: "COMPLETED", supportingDocumentId: "supporting" })
})

describe("template upload completion authorization", () => {
  it("completes only the original staff uploader's attempt with a live admin role", async () => {
    const { response, body } = await call()
    expect(response.status).toBe(200)
    expect(body.data.templateId).toBe("template")
    expect(body.data.ownerId).toBe("template")
    expect(requireRoleMock).toHaveBeenCalledWith(ORG, ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"], "complete document template upload")
    expect(completeMock).toHaveBeenCalledWith(ATTEMPT, STAFF)
  })

  it("hides another staff user's attempt", async () => {
    findAttemptMock.mockResolvedValue(templateAttempt({ staffUserId: "someone-else" }))
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

describe("staff supporting upload completion authorization", () => {
  it("reauthorizes against the intent's client/packet binding before completing", async () => {
    findAttemptMock.mockResolvedValue(supportingAttempt())
    const { response, body } = await call()
    expect(response.status).toBe(200)
    expect(body.data.ownerId).toBe("supporting")
    expect(authorizeSupportingMock).toHaveBeenCalledWith({ clientId: CLIENT, packetId: null })
    expect(completeSupportingMock).toHaveBeenCalledWith(ATTEMPT, STAFF)
    expect(requireRoleMock).not.toHaveBeenCalled()
  })

  it("rejects supporting authorization revoked while the scan was pending", async () => {
    findAttemptMock.mockResolvedValue(supportingAttempt())
    authorizeSupportingMock.mockRejectedValue(new Error("revoked"))
    const { response } = await call()
    expect(response.status).toBe(403)
    expect(completeSupportingMock).not.toHaveBeenCalled()
  })

  it("rejects a reauthorization that resolves to a different organization", async () => {
    findAttemptMock.mockResolvedValue(supportingAttempt())
    authorizeSupportingMock.mockResolvedValue({ userId: STAFF, organizationId: "cm99345678901234567890123", clientId: CLIENT })
    const { response } = await call()
    expect(response.status).toBe(403)
    expect(completeSupportingMock).not.toHaveBeenCalled()
  })

  it("hides a supporting attempt with no intent row", async () => {
    findAttemptMock.mockResolvedValue(supportingAttempt({ supportingIntent: null }))
    const { response } = await call()
    expect(response.status).toBe(404)
    expect(completeSupportingMock).not.toHaveBeenCalled()
  })

  it("hides portal attempts from the staff completion route", async () => {
    findAttemptMock.mockResolvedValue(supportingAttempt({ actorType: "PORTAL", staffUserId: null, uploadKind: "PORTAL_REQUEST" }))
    const { response } = await call()
    expect(response.status).toBe(404)
    expect(completeSupportingMock).not.toHaveBeenCalled()
    expect(completeMock).not.toHaveBeenCalled()
  })
})
