// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const requirePortalAuthMock = vi.fn()
const requirePortalPermissionMock = vi.fn()
const findAttemptMock = vi.fn()
const completePortalUploadMock = vi.fn()

class PortalAuthError extends Error {}

vi.mock("@/lib/db", () => ({
  prisma: { uploadAttempt: { findUnique: (...a: unknown[]) => findAttemptMock(...a) } },
}))
vi.mock("@/lib/portal/auth", () => ({
  PortalAuthError,
  requirePortalAuth: (...a: unknown[]) => requirePortalAuthMock(...a),
  requirePortalPermission: (...a: unknown[]) => requirePortalPermissionMock(...a),
}))
vi.mock("@/lib/uploads/supporting-upload", () => ({
  completePortalUpload: (...a: unknown[]) => completePortalUploadMock(...a),
}))

const ATTEMPT_ID = "cm42345678901234567890123"
const PORTAL_USER_ID = "cm52345678901234567890123"
const CLIENT_ID = "cm32345678901234567890123"

function portalAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    organizationId: "cm12345678901234567890123",
    uploadKind: "PORTAL_REQUEST",
    actorType: "PORTAL",
    portalUserId: PORTAL_USER_ID,
    staffUserId: null,
    intendedOwnerType: "SUPPORTING_DOCUMENT",
    intendedOwnerId: "owner-1",
    status: "SCANNING",
    malwareStatus: "PENDING",
    cleanupStatus: "PENDING",
    failureStage: null,
    failureCategory: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    supportingIntent: { clientId: CLIENT_ID, portalRequestId: "cm62345678901234567890123" },
    ...overrides,
  }
}

async function callStatus(attemptId = ATTEMPT_ID) {
  const { GET } = await import("@/app/api/portal-uploads/[attemptId]/status/route")
  const response = await GET(new Request("http://localhost"), { params: Promise.resolve({ attemptId }) })
  return { response, body: await response.json() }
}

async function callComplete(attemptId = ATTEMPT_ID) {
  const { POST } = await import("@/app/api/portal-uploads/[attemptId]/complete/route")
  const response = await POST(new Request("http://localhost"), { params: Promise.resolve({ attemptId }) })
  return { response, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePortalAuthMock.mockResolvedValue({ portalUserId: PORTAL_USER_ID })
  requirePortalPermissionMock.mockResolvedValue(undefined)
  findAttemptMock.mockResolvedValue(portalAttempt())
  completePortalUploadMock.mockResolvedValue({ attemptId: ATTEMPT_ID, status: "COMPLETED", supportingDocumentId: "owner-1" })
})

describe("portal upload status route", () => {
  it("returns only bounded lifecycle state to the original uploader", async () => {
    const { response, body } = await callStatus()
    expect(response.status).toBe(200)
    expect(body.data.status).toBe("SCANNING")
    expect(body.data.attemptId).toBe(ATTEMPT_ID)
    const encoded = JSON.stringify(body)
    expect(encoded).not.toContain("bucket")
    expect(encoded).not.toContain("objectKey")
    expect(encoded).not.toContain("checksum")
    expect(encoded).not.toContain("scannerReference")
    expect(requirePortalPermissionMock).toHaveBeenCalledWith(CLIENT_ID, "canUploadDocuments")
  })

  it("hides another portal user's attempt", async () => {
    findAttemptMock.mockResolvedValue(portalAttempt({ portalUserId: "cm99345678901234567890123" }))
    const { response } = await callStatus()
    expect(response.status).toBe(404)
  })

  it("hides staff attempts entirely", async () => {
    findAttemptMock.mockResolvedValue(portalAttempt({ actorType: "STAFF", portalUserId: null, staffUserId: "cm22345678901234567890123", uploadKind: "STAFF_SUPPORTING" }))
    const { response } = await callStatus()
    expect(response.status).toBe(404)
  })

  it("rejects when portal access to the client was revoked during scanning", async () => {
    requirePortalPermissionMock.mockRejectedValue(new Error("revoked"))
    const { response } = await callStatus()
    expect(response.status).toBe(403)
  })

  it("rejects unauthenticated calls", async () => {
    requirePortalAuthMock.mockRejectedValue(new PortalAuthError("no session"))
    const { response } = await callStatus()
    expect(response.status).toBe(401)
  })

  it("rejects malformed attempt identifiers without a database lookup", async () => {
    const { response } = await callStatus("../nope")
    expect(response.status).toBe(404)
    expect(findAttemptMock).not.toHaveBeenCalled()
  })
})

describe("portal upload completion route", () => {
  it("rechecks canUploadDocuments before invoking completion", async () => {
    const { response, body } = await callComplete()
    expect(response.status).toBe(200)
    expect(body.data.ownerId).toBe("owner-1")
    expect(requirePortalPermissionMock).toHaveBeenCalledWith(CLIENT_ID, "canUploadDocuments")
    expect(completePortalUploadMock).toHaveBeenCalledWith(ATTEMPT_ID, PORTAL_USER_ID)
  })

  it("rejects a permission revoked during scanning without invoking completion", async () => {
    requirePortalPermissionMock.mockRejectedValue(new Error("revoked"))
    const { response } = await callComplete()
    expect(response.status).toBe(403)
    expect(completePortalUploadMock).not.toHaveBeenCalled()
  })

  it("hides another portal user's attempt", async () => {
    findAttemptMock.mockResolvedValue(portalAttempt({ portalUserId: "cm99345678901234567890123" }))
    const { response } = await callComplete()
    expect(response.status).toBe(404)
    expect(completePortalUploadMock).not.toHaveBeenCalled()
  })

  it("maps bounded lifecycle conflicts to 409", async () => {
    const { UploadLifecycleError } = await import("@/lib/uploads/errors")
    completePortalUploadMock.mockRejectedValue(new UploadLifecycleError("CONFLICT", "This request cannot accept an upload right now."))
    const { response, body } = await callComplete()
    expect(response.status).toBe(409)
    expect(body.error).toMatch(/cannot accept/i)
  })

  it("maps an incomplete scan to 409 without leaking scanner details", async () => {
    const { UploadLifecycleError } = await import("@/lib/uploads/errors")
    completePortalUploadMock.mockRejectedValue(new UploadLifecycleError("SCAN_UNAVAILABLE", "The verified malware scan is not complete."))
    const { response } = await callComplete()
    expect(response.status).toBe(409)
  })

  it("returns 202 while quarantine cleanup is still pending", async () => {
    completePortalUploadMock.mockResolvedValue({ attemptId: ATTEMPT_ID, status: "LINKED_CLEANUP_PENDING", supportingDocumentId: "owner-1" })
    const { response, body } = await callComplete()
    expect(response.status).toBe(202)
    expect(body.data.ownerId).toBe("owner-1")
  })
})
