// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const authorizeSupportingMock = vi.fn()
const initiateMock = vi.fn()
const assertRuntimeMock = vi.fn()

class SupportingUploadAuthorizationError extends Error {}

vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: () => authMock(),
}))
vi.mock("@/lib/uploads/staff-supporting-authorization", () => ({
  SupportingUploadAuthorizationError,
  authorizeStaffSupportingUpload: (...a: unknown[]) => authorizeSupportingMock(...a),
}))
vi.mock("@/lib/uploads/supporting-upload", () => ({
  initiateStaffSupportingUpload: (...a: unknown[]) => initiateMock(...a),
}))
vi.mock("@/lib/uploads/receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uploads/receipt")>()
  return { ...actual, assertUploadRuntimeAvailable: (...a: unknown[]) => assertRuntimeMock(...a) }
})
vi.mock("@/lib/rate-limit", () => ({
  limiters: { upload: { check: () => ({ allowed: true, remaining: 9, retryAfter: 0 }) } },
}))

const ORG_ID = "cm12345678901234567890123"
const STAFF_ID = "cm22345678901234567890123"
const CLIENT_ID = "cm32345678901234567890123"
const PACKET_ID = "cm82345678901234567890123"
const ATTEMPT_ID = "cm42345678901234567890123"
const IDEMPOTENCY_KEY = "b2345678-1234-4234-9234-123456789abc"
const PDF = Buffer.from("%PDF-1.4\nfixture")

function multipart(fields: Record<string, string>, includeFile = true) {
  const boundary = "----higsiSupportingBoundary"
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  if (includeFile) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="care-plan.pdf"\r\nContent-Type: application/pdf\r\n\r\n`))
    parts.push(PDF, Buffer.from("\r\n"))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function call(query = "", fields: Record<string, string> = { title: "Care plan" }, includeFile = true) {
  const { body, contentType } = multipart(fields, includeFile)
  const request = new NextRequest(`http://localhost/api/supporting-documents${query}`, {
    method: "POST",
    headers: { "content-type": contentType, "idempotency-key": IDEMPOTENCY_KEY },
    body: new Uint8Array(body),
  })
  const { POST } = await import("@/app/api/supporting-documents/route")
  const response = await POST(request)
  return { response, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ userId: STAFF_ID, selectedOrganizationId: ORG_ID })
  authorizeSupportingMock.mockResolvedValue({ userId: STAFF_ID, organizationId: ORG_ID, clientId: undefined, packetId: undefined })
  assertRuntimeMock.mockReturnValue(undefined)
  initiateMock.mockResolvedValue({ attemptId: ATTEMPT_ID, status: "SCANNING" })
})

describe("staff supporting upload receipt route", () => {
  it("authorizes from query-string binding targets before any multipart parsing", async () => {
    const { response, body } = await call(`?clientId=${CLIENT_ID}`)
    expect(response.status).toBe(202)
    expect(body.data).toEqual({ attemptId: ATTEMPT_ID, status: "SCANNING" })
    expect(authorizeSupportingMock).toHaveBeenCalledWith({ clientId: CLIENT_ID, packetId: undefined })
  })

  it("passes the packet binding through to authorization", async () => {
    authorizeSupportingMock.mockResolvedValue({ userId: STAFF_ID, organizationId: ORG_ID, clientId: CLIENT_ID, packetId: PACKET_ID })
    await call(`?packetId=${PACKET_ID}`)
    expect(authorizeSupportingMock).toHaveBeenCalledWith({ clientId: undefined, packetId: PACKET_ID })
    expect(initiateMock).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({ clientId: CLIENT_ID, packetId: PACKET_ID }),
    }))
  })

  it("rejects non-opaque binding identifiers before authorization", async () => {
    const { response } = await call("?clientId=1%20OR%201=1")
    expect(response.status).toBe(400)
    expect(authorizeSupportingMock).not.toHaveBeenCalled()
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("rejects unauthorized staff with the authorization message", async () => {
    authorizeSupportingMock.mockRejectedValue(new SupportingUploadAuthorizationError("Insufficient permissions"))
    const { response, body } = await call()
    expect(response.status).toBe(403)
    expect(body.error).toBe("Insufficient permissions")
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("fails closed before multipart parsing when the runtime gate is unavailable", async () => {
    const { UploadRuntimeUnavailableError } = await import("@/lib/uploads/receipt")
    assertRuntimeMock.mockImplementation(() => {
      throw new UploadRuntimeUnavailableError()
    })
    const request = new NextRequest("http://localhost/api/supporting-documents", { method: "POST" })
    const { POST } = await import("@/app/api/supporting-documents/route")
    const response = await POST(request)
    expect(response.status).toBe(503)
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("carries the staff-entered metadata and idempotency key into the pipeline", async () => {
    await call("", { title: "Assessment Q3", category: "assessment", description: "Quarterly" })
    expect(initiateMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      intent: expect.objectContaining({ title: "Assessment Q3", category: "assessment", description: "Quarterly" }),
    }))
  })

  it("falls back to the filename when no title is provided, as the legacy action did", async () => {
    await call("", {})
    expect(initiateMock).toHaveBeenCalledWith(expect.objectContaining({
      intent: expect.objectContaining({ title: "care-plan.pdf" }),
    }))
  })

  it("rejects a missing file after authorization", async () => {
    const { response } = await call("", { title: "Care plan" }, false)
    expect(response.status).toBe(400)
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("rejects unauthenticated calls", async () => {
    authMock.mockRejectedValue(new Error("no session"))
    const { response } = await call()
    expect(response.status).toBe(401)
    expect(initiateMock).not.toHaveBeenCalled()
  })
})
