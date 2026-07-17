// @vitest-environment node
//
// This file is forced to the Node environment (overriding the project's
// default jsdom) because jsdom's File/FormData globals shadow undici's,
// which NextRequest relies on internally to parse multipart bodies —
// under jsdom, that parsing throws a cross-realm webidl assertion error.
// This route has no DOM dependency, so Node is also the more accurate
// environment for it regardless.
//
// PR-5B.3: the portal route is now initiate-only — it authorizes, gates,
// and hands the multipart file to the shared upload pipeline. Deep
// validation, quarantine, completion linkage, timeline, audit, and
// notification behavior are covered by the supporting-upload lib suites.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const portalSessionFindUnique = vi.fn()
const portalClientAccessFindFirst = vi.fn()
const clientFindUnique = vi.fn()
const portalDocumentRequestFindUnique = vi.fn()
const initiatePortalUploadMock = vi.fn()
const assertRuntimeMock = vi.fn()

const cookieStore = new Map<string, string>()
const cookiesMock = {
  get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  set: () => {},
  delete: () => {},
}

vi.mock("@/lib/db", () => ({
  prisma: {
    portalSession: { findUnique: (...a: unknown[]) => portalSessionFindUnique(...a) },
    portalClientAccess: { findFirst: (...a: unknown[]) => portalClientAccessFindFirst(...a) },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    portalDocumentRequest: { findUnique: (...a: unknown[]) => portalDocumentRequestFindUnique(...a) },
  },
}))
vi.mock("next/headers", () => ({ cookies: async () => cookiesMock }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { portalUpload: { check: () => ({ allowed: true, remaining: 10, retryAfter: 0, total: 10, resetAt: 0 }) } },
}))
vi.mock("@/lib/uploads/supporting-upload", () => ({
  initiatePortalUpload: (...a: unknown[]) => initiatePortalUploadMock(...a),
}))
vi.mock("@/lib/uploads/receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uploads/receipt")>()
  return {
    ...actual,
    assertUploadRuntimeAvailable: (...a: unknown[]) => assertRuntimeMock(...a),
  }
})

const ORG_ID = "org-1"
const CLIENT_ID = "client-0000001"
const REQUEST_ID = "req-0000001"
const PORTAL_USER_ID = "pu-1"

function activeAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1", organizationId: ORG_ID, accessRole: "GUARDIAN", relationship: "Mother",
    canViewDocuments: true, canUploadDocuments: true, canSignDocuments: false,
    canViewAppointments: false, canMessageCareTeam: false, canManageOtherGuardians: false,
    ...overrides,
  }
}

function baseRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, organizationId: ORG_ID, clientId: CLIENT_ID, packetId: null,
    title: "Insurance Card", category: "INSURANCE", status: "PENDING",
    ...overrides,
  }
}

function validSession() {
  cookieStore.set("portal_session", "a".repeat(64))
  portalSessionFindUnique.mockResolvedValue({
    id: "sess-1", revokedAt: null, expires: new Date(Date.now() + 60000),
    portalUser: { id: PORTAL_USER_ID, email: "guardian@example.com", status: "ACTIVE", emailVerifiedAt: new Date() },
  })
}

const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock-pdf-content-for-tests\n")

interface FakeFile { bytes: Buffer; name: string; type: string }

function makeFile(bytes: Buffer, name: string, type: string): FakeFile {
  return { bytes, name, type }
}

// Builds a raw multipart/form-data body by hand rather than using the
// FormData/File web APIs — jsdom's File class and undici's (used internally
// by NextRequest) are different, incompatible classes in this test runtime,
// so constructing a real multipart byte stream sidesteps that mismatch
// entirely and exercises the exact same parser the route uses in production.
function buildMultipartBody(file: FakeFile): { body: Buffer; contentType: string } {
  const boundary = "----vitestBoundary" + Math.random().toString(16).slice(2)
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  return { body: Buffer.concat([head, file.bytes, tail]), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function callUploadRoute(requestId: string, file: FakeFile, idempotencyKey = "9f3a1b8e-4c2d-4f6a-8b1e-2d3c4e5f6a7b") {
  const { POST } = await import("@/app/api/portal-upload/[requestId]/route")
  const { body, contentType } = buildMultipartBody(file)
  const req = new NextRequest("http://localhost/api/portal-upload/" + requestId, {
    method: "POST",
    headers: { "content-type": contentType, "idempotency-key": idempotencyKey },
    body: new Uint8Array(body),
  })
  const res = await POST(req, { params: Promise.resolve({ requestId }) })
  const resBody = await res.json()
  return { status: res.status, body: resBody }
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
  assertRuntimeMock.mockReturnValue(undefined)
  initiatePortalUploadMock.mockResolvedValue({ attemptId: "cm42345678901234567890123", status: "SCANNING" })
})

describe("portal upload route — authorization", () => {
  it("accepts receipt for a valid session, active grant, and canUploadDocuments=true", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(202)
    expect(body.success).toBe(true)
    expect(body.data.status).toBe("SCANNING")
    expect(body.data.attemptId).toBeTruthy()
  })

  it("derives every trust decision from the request row, never the body", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    const initiateInput = initiatePortalUploadMock.mock.calls[0][0]
    expect(initiateInput.organizationId).toBe(ORG_ID)
    expect(initiateInput.clientId).toBe(CLIENT_ID)
    expect(initiateInput.requestId).toBe(REQUEST_ID)
    expect(initiateInput.portalUserId).toBe(PORTAL_USER_ID)
    expect(initiateInput.idempotencyKey).toBe("9f3a1b8e-4c2d-4f6a-8b1e-2d3c4e5f6a7b")
  })

  it("rejects when canUploadDocuments is false", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess({ canUploadDocuments: false }))
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(initiatePortalUploadMock).not.toHaveBeenCalled()
  })

  it("rejects when there is no session at all", async () => {
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(401)
    expect(initiatePortalUploadMock).not.toHaveBeenCalled()
  })

  it("rejects when the access grant is missing (no active grant for this client)", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(null)

    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(403)
  })

  it("rejects when the grant's organization does not match the client's current organization", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: "org-DIFFERENT" })

    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(403)
  })

  it("rejects an invalid/nonexistent request ID", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(null)

    const { status, body } = await callUploadRoute("does-not-exist", makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it("rejects uploading to a cancelled request", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "CANCELLED" }))
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(409)
  })

  it("rejects uploading to an already-approved request", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "APPROVED" }))
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(409)
  })
})

describe("portal upload route — receipt boundary", () => {
  beforeEach(() => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
  })

  it("returns unavailable before the pipeline runs when the operating gate is closed", async () => {
    const { UploadRuntimeUnavailableError } = await import("@/lib/uploads/receipt")
    assertRuntimeMock.mockImplementation(() => {
      throw new UploadRuntimeUnavailableError()
    })
    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(503)
    expect(body.error).toMatch(/temporarily unavailable/i)
    expect(initiatePortalUploadMock).not.toHaveBeenCalled()
  })

  it("sanitizes a path-traversal filename before it reaches the intent", async () => {
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "../../etc/passwd.pdf", "application/pdf"))
    const initiateInput = initiatePortalUploadMock.mock.calls[0][0]
    expect(initiateInput.originalFileName).not.toContain("/")
    expect(initiateInput.originalFileName).not.toContain("..")
  })

  it("maps pipeline validation failures to bounded 400 responses", async () => {
    const { UploadValidationError } = await import("@/lib/uploads/errors")
    const { UploadFailureCategory } = await import("@prisma/client")
    initiatePortalUploadMock.mockRejectedValue(
      new UploadValidationError("TYPE_MISMATCH", "The uploaded file type is not permitted.", UploadFailureCategory.TYPE_MISMATCH),
    )
    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "photo.heic", "image/heic"))
    expect(status).toBe(400)
    expect(body.error).toMatch(/not permitted/i)
  })

  it("maps idempotency replays of a failed key to a bounded 409", async () => {
    const { UploadLifecycleError } = await import("@/lib/uploads/errors")
    initiatePortalUploadMock.mockRejectedValue(new UploadLifecycleError("CONFLICT", "This upload key has already failed."))
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(409)
  })

  it("rejects a missing file part without invoking the pipeline", async () => {
    const { POST } = await import("@/app/api/portal-upload/[requestId]/route")
    const boundary = "----vitestBoundaryEmpty"
    const body = Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="note"\r\n\r\nhello\r\n--${boundary}--\r\n`)
    const req = new NextRequest("http://localhost/api/portal-upload/" + REQUEST_ID, {
      method: "POST",
      headers: { "content-type": `multipart/form-data; boundary=${boundary}` },
      body: new Uint8Array(body),
    })
    const res = await POST(req, { params: Promise.resolve({ requestId: REQUEST_ID }) })
    expect(res.status).toBe(400)
    expect(initiatePortalUploadMock).not.toHaveBeenCalled()
  })
})
