// @vitest-environment node
//
// This file is forced to the Node environment (overriding the project's
// default jsdom) because jsdom's File/FormData globals shadow undici's,
// which NextRequest relies on internally to parse multipart bodies —
// under jsdom, that parsing throws a cross-realm webidl assertion error.
// This route has no DOM dependency, so Node is also the more accurate
// environment for it regardless.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const portalSessionFindUnique = vi.fn()
const portalClientAccessFindFirst = vi.fn()
const clientFindUnique = vi.fn()
const portalDocumentRequestFindUnique = vi.fn()
const supportingDocumentCreate = vi.fn()
const portalDocumentTimelineEventCreate = vi.fn()
const createPortalAuditEventMock = vi.fn()
const storeFileMock = vi.fn()
const notifySingleMock = vi.fn()

const cookieStore = new Map<string, string>()
const cookiesMock = {
  get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  set: () => {},
  delete: () => {},
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    portalDocumentRequest: { updateMany: vi.fn().mockResolvedValue({ count: 1 }), ...overrides.portalDocumentRequest },
    supportingDocument: { create: (...a: unknown[]) => supportingDocumentCreate(...a), ...overrides.supportingDocument },
    portalDocumentTimelineEvent: { create: (...a: unknown[]) => portalDocumentTimelineEventCreate(...a), ...overrides.portalDocumentTimelineEvent },
  }
}

let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    portalSession: { findUnique: (...a: unknown[]) => portalSessionFindUnique(...a) },
    portalClientAccess: { findFirst: (...a: unknown[]) => portalClientAccessFindFirst(...a) },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    portalDocumentRequest: { findUnique: (...a: unknown[]) => portalDocumentRequestFindUnique(...a) },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("next/headers", () => ({ cookies: async () => cookiesMock }))
vi.mock("@/lib/audit", () => ({ createPortalAuditEvent: (...a: unknown[]) => createPortalAuditEventMock(...a) }))
vi.mock("@/lib/portal/notifications", () => ({ notifySinglePortalUser: (...a: unknown[]) => notifySingleMock(...a) }))
vi.mock("@/lib/storage", () => ({ storeFile: (...a: unknown[]) => storeFileMock(...a) }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { portalUpload: { check: () => ({ allowed: true, remaining: 10, retryAfter: 0, total: 10, resetAt: 0 }) } },
}))

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

// Minimal valid byte signatures for each accepted type.
const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock-pdf-content-for-tests\n")
const JPEG_BYTES = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(100, 1)])
const PNG_BYTES = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(50, 1)])
const DOCX_BYTES = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(50, 1)])
const TEXT_BYTES = Buffer.from("just plain text, not a real document")

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

async function callUploadRoute(requestId: string, file: FakeFile) {
  const { POST } = await import("@/app/api/portal-upload/[requestId]/route")
  const { body, contentType } = buildMultipartBody(file)
  const req = new NextRequest("http://localhost/api/portal-upload/" + requestId, {
    method: "POST",
    headers: { "content-type": contentType },
    body: new Uint8Array(body),
  })
  const res = await POST(req, { params: Promise.resolve({ requestId }) })
  const resBody = await res.json()
  return { status: res.status, body: resBody }
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
  storeFileMock.mockResolvedValue({ key: "portal-uploads/x", url: "/api/files/x", signedUrl: "/api/files/x?sig=1", size: 100, mimeType: "application/pdf", originalName: "file.pdf" })
  supportingDocumentCreate.mockResolvedValue({ id: "supdoc-1" })
})

describe("portal upload route — authorization", () => {
  it("succeeds for a valid session, active grant, and canUploadDocuments=true", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(200)
    expect(body.success).toBe(true)
  })

  it("rejects when canUploadDocuments is false", async () => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess({ canUploadDocuments: false }))
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })

    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(403)
    expect(body.success).toBe(false)
  })

  it("rejects when there is no session at all", async () => {
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(401)
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

describe("portal upload route — file validation", () => {
  beforeEach(() => {
    validSession()
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
  })

  it("accepts a valid PDF", async () => {
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(200)
  })

  it("accepts a valid JPEG", async () => {
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(JPEG_BYTES, "photo.jpg", "image/jpeg"))
    expect(status).toBe(200)
  })

  it("accepts a valid PNG", async () => {
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(PNG_BYTES, "photo.png", "image/png"))
    expect(status).toBe(200)
  })

  it("accepts a valid DOCX", async () => {
    const { status } = await callUploadRoute(REQUEST_ID, makeFile(DOCX_BYTES, "form.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"))
    expect(status).toBe(200)
  })

  it("rejects a disallowed file type", async () => {
    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(TEXT_BYTES, "notes.exe", "application/octet-stream"))
    expect(status).toBe(400)
    expect(body.error).toMatch(/unsupported/i)
  })

  it("rejects an oversized file", async () => {
    const oversized = Buffer.concat([PDF_BYTES, Buffer.alloc(26 * 1024 * 1024)])
    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(oversized, "big.pdf", "application/pdf"))
    expect(status).toBe(400)
    expect(body.error).toMatch(/25 MB/i)
  })

  it("rejects an empty file", async () => {
    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(Buffer.alloc(0), "empty.pdf", "application/pdf"))
    expect(status).toBe(400)
    expect(body.error).toMatch(/empty/i)
  })

  it("sanitizes a path-traversal filename instead of using it as-is", async () => {
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "../../etc/passwd.pdf", "application/pdf"))
    const createData = supportingDocumentCreate.mock.calls[0][0].data
    expect(createData.originalFileName).not.toContain("/")
    expect(createData.originalFileName).not.toContain("..")
  })

  it("rejects a MIME/signature mismatch (PNG extension, non-PNG bytes)", async () => {
    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(TEXT_BYTES, "fake.png", "image/png"))
    expect(status).toBe(400)
    expect(body.error).toMatch(/does not match/i)
  })
})

describe("portal upload route — persistence", () => {
  beforeEach(() => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
  })

  it("creates a new SupportingDocument linked to the request and the uploading portal user", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))

    const createData = supportingDocumentCreate.mock.calls[0][0].data
    expect(createData.portalRequestId).toBe(REQUEST_ID)
    expect(createData.uploadedByPortalUserId).toBe(PORTAL_USER_ID)
    expect(createData.clientId).toBe(CLIENT_ID)
    expect(createData.organizationId).toBe(ORG_ID)
  })

  it("transitions a PENDING request to SUBMITTED and writes an UPLOADED event", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "PENDING" }))
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))

    const updateWhere = currentTx.portalDocumentRequest.updateMany.mock.calls[0][0]
    expect(updateWhere.data.status).toBe("SUBMITTED")
    const eventData = portalDocumentTimelineEventCreate.mock.calls[0][0].data
    expect(eventData.eventType).toBe("UPLOADED")
  })

  it("transitions a NEEDS_REPLACEMENT request to SUBMITTED and writes a RESUBMITTED event, creating a new row rather than overwriting", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "NEEDS_REPLACEMENT" }))
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance-v2.pdf", "application/pdf"))

    const eventData = portalDocumentTimelineEventCreate.mock.calls[0][0].data
    expect(eventData.eventType).toBe("RESUBMITTED")
    // A resubmission always calls create (never update/upsert) on SupportingDocument — no overwrite path exists.
    expect(supportingDocumentCreate).toHaveBeenCalledTimes(1)
  })

  it("writes a portal audit event with only safe identifiers — no PHI, raw file bytes, or tokens", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))

    const auditCall = createPortalAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PORTAL_DOCUMENT_UPLOADED")
    expect(auditCall.metadata).toEqual({
      requestId: REQUEST_ID, supportingDocumentId: "supdoc-1", fileSize: 100, mimeType: "application/pdf", eventType: "UPLOADED",
    })
    const serialized = JSON.stringify(auditCall)
    expect(serialized).not.toContain("%PDF")
    expect(serialized).not.toContain("Insurance Card")
  })

  it("notifies only the uploading portal user that their upload was received — no fan-out, no staff Notification row", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))

    expect(notifySingleMock).toHaveBeenCalledTimes(1)
    const [notifiedUserId, notifyInput, txArg] = notifySingleMock.mock.calls[0]
    expect(notifiedUserId).toBe(PORTAL_USER_ID)
    expect(notifyInput.type).toBe("upload_received")
    expect(notifyInput.link).toBe(`/portal/upload?client=${CLIENT_ID}&request=${REQUEST_ID}`)
    expect(notifyInput.metadata).toEqual({ requestId: REQUEST_ID, clientId: CLIENT_ID, event: "upload_received" })
    // Passed the transaction client so the notification commits atomically with the upload.
    expect(txArg).toBe(currentTx)
  })

  it("rejects a concurrent double-upload race via the conditional status update", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest())
    currentTx.portalDocumentRequest.updateMany.mockResolvedValue({ count: 0 })

    const { status, body } = await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance.pdf", "application/pdf"))
    expect(status).toBe(409)
    expect(body.success).toBe(false)
    expect(supportingDocumentCreate).not.toHaveBeenCalled()
  })

  it("a replacement upload creates a new attempt starting PENDING_REVIEW, never touching the prior NEEDS_REPLACEMENT attempt", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "NEEDS_REPLACEMENT" }))
    await callUploadRoute(REQUEST_ID, makeFile(PDF_BYTES, "insurance-v2.pdf", "application/pdf"))

    const createData = supportingDocumentCreate.mock.calls[0][0].data
    expect(createData.reviewStatus).toBe("PENDING_REVIEW")
    // The route never issues any update/upsert against a prior SupportingDocument row —
    // the only supportingDocument call made is the new create, so the prior
    // NEEDS_REPLACEMENT attempt is left completely untouched.
    expect(supportingDocumentCreate).toHaveBeenCalledTimes(1)
  })
})
