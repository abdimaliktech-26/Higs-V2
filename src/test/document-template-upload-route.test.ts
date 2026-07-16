// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"

const authMock = vi.fn()
const requireRoleMock = vi.fn()
const findTemplateMock = vi.fn()
const initiateMock = vi.fn()
const runtimeMock = vi.fn()

class UnavailableError extends Error {
  constructor() { super("Secure template uploads are temporarily unavailable."); this.name = "TemplateUploadUnavailableError" }
}

vi.mock("@/lib/db", () => ({
  prisma: { documentTemplate: { findUnique: (...args: unknown[]) => findTemplateMock(...args) } },
}))
vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: () => authMock(),
  requireOrganizationRole: (...args: unknown[]) => requireRoleMock(...args),
}))
vi.mock("@/lib/uploads/template-upload", () => ({
  assertTemplateUploadRuntimeAvailable: () => runtimeMock(),
  initiateTemplateUpload: (...args: unknown[]) => initiateMock(...args),
  TemplateUploadUnavailableError: UnavailableError,
}))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { upload: { check: () => ({ allowed: true, remaining: 9, retryAfter: 0 }) } },
}))

const ORG_ID = "cm12345678901234567890123"
const STAFF_ID = "cm22345678901234567890123"
const TEMPLATE_ID = "cm32345678901234567890123"
const ATTEMPT_ID = "cm42345678901234567890123"
const IDEMPOTENCY_KEY = "b2345678-1234-4234-9234-123456789abc"
const PDF = Buffer.from("%PDF-1.4\nfixture")

function multipart(fields: Record<string, string>, includeFile = true) {
  const boundary = "----higsiTemplateBoundary"
  const parts: Buffer[] = []
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`))
  }
  if (includeFile) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="form.pdf"\r\nContent-Type: application/pdf\r\n\r\n`))
    parts.push(PDF, Buffer.from("\r\n"))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function createRequest(includeFile = true, idempotencyKey = IDEMPOTENCY_KEY) {
  const { body, contentType } = multipart({ name: "CSSP Addendum", formType: "dhs" }, includeFile)
  const request = new NextRequest("http://localhost/api/templates", {
    method: "POST",
    headers: { "content-type": contentType, "idempotency-key": idempotencyKey },
    body: new Uint8Array(body),
  })
  const { POST } = await import("@/app/api/templates/route")
  const response = await POST(request)
  return { response, body: await response.json() }
}

async function versionRequest(idempotencyKey = IDEMPOTENCY_KEY) {
  const { body, contentType } = multipart({})
  const request = new NextRequest(`http://localhost/api/templates/${TEMPLATE_ID}/versions`, {
    method: "POST",
    headers: { "content-type": contentType, "idempotency-key": idempotencyKey },
    body: new Uint8Array(body),
  })
  const { POST } = await import("@/app/api/templates/[templateId]/versions/route")
  const response = await POST(request, { params: Promise.resolve({ templateId: TEMPLATE_ID }) })
  return { response, body: await response.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  runtimeMock.mockReset()
  authMock.mockResolvedValue({ userId: STAFF_ID, selectedOrganizationId: ORG_ID })
  requireRoleMock.mockResolvedValue({ userId: STAFF_ID, organizationId: ORG_ID, role: "ORG_ADMIN" })
  findTemplateMock.mockResolvedValue({
    id: TEMPLATE_ID,
    organizationId: ORG_ID,
    name: "CSSP Addendum",
    description: null,
    formType: "dhs",
    program: null,
    version: 1,
  })
  initiateMock.mockResolvedValue({ attemptId: ATTEMPT_ID, status: "SCANNING" })
})

describe("PR-5B.2B template upload receipt routes", () => {
  it("starts a new-template attempt and returns 202 without creating an owner", async () => {
    const { response, body } = await createRequest()
    expect(response.status).toBe(202)
    expect(body.data).toEqual({ attemptId: ATTEMPT_ID, status: "SCANNING" })
    expect(initiateMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      intent: expect.objectContaining({ name: "CSSP Addendum", formType: "dhs" }),
    }))
  })

  it("requires an active admin role before upload processing", async () => {
    requireRoleMock.mockRejectedValue(new Error("denied"))
    const { response } = await createRequest()
    expect(response.status).toBe(403)
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("fails closed before multipart parsing when the runtime gate is unavailable", async () => {
    runtimeMock.mockImplementation(() => { throw new UnavailableError() })
    const request = new NextRequest("http://localhost/api/templates", { method: "POST" })
    const { POST } = await import("@/app/api/templates/route")
    const response = await POST(request)
    expect(response.status).toBe(503)
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("rejects a missing file after authorization and capability checks", async () => {
    const { response } = await createRequest(false)
    expect(response.status).toBe(400)
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("passes the client UUID idempotency key to the lifecycle", async () => {
    const other = "a2345678-1234-4234-9234-123456789abc"
    await createRequest(true, other)
    expect(initiateMock).toHaveBeenCalledWith(expect.objectContaining({ idempotencyKey: other }))
  })

  it("starts a template-version attempt using the previous template snapshot", async () => {
    const { response, body } = await versionRequest()
    expect(response.status).toBe(202)
    expect(body.data.status).toBe("SCANNING")
    expect(initiateMock).toHaveBeenCalledWith(expect.objectContaining({
      organizationId: ORG_ID,
      intent: {
        name: "CSSP Addendum",
        description: undefined,
        formType: "dhs",
        program: undefined,
        previousVersionId: TEMPLATE_ID,
      },
    }))
  })

  it("authorizes a version using the previous template's organization", async () => {
    await versionRequest()
    expect(requireRoleMock).toHaveBeenCalledWith(
      ORG_ID,
      ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
      "upload document template version",
    )
  })

  it("returns 404 before processing a nonexistent previous version", async () => {
    findTemplateMock.mockResolvedValue(null)
    const { response } = await versionRequest()
    expect(response.status).toBe(404)
    expect(initiateMock).not.toHaveBeenCalled()
  })

  it("does not expose storage identity in the receipt response", async () => {
    const { body } = await createRequest()
    const encoded = JSON.stringify(body)
    expect(encoded).not.toContain("bucket")
    expect(encoded).not.toContain("objectKey")
    expect(encoded).not.toContain("kms")
  })
})
