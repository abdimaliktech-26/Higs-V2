// @vitest-environment node
//
// Forced to the Node environment (overriding the project's default jsdom)
// because jsdom's File/FormData globals shadow undici's, which NextRequest
// relies on internally to parse multipart bodies — under jsdom, that parsing
// throws a cross-realm webidl assertion error. Matches the same workaround
// used for the portal upload route's tests.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const documentTemplateCreate = vi.fn()
const documentTemplateFindUnique = vi.fn()
const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const storeFileMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    documentTemplate: {
      create: (...a: unknown[]) => documentTemplateCreate(...a),
      findUnique: (...a: unknown[]) => documentTemplateFindUnique(...a),
    },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/storage", () => ({ storeFile: (...a: unknown[]) => storeFileMock(...a) }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { upload: { check: () => ({ allowed: true, remaining: 10, retryAfter: 0, total: 10, resetAt: 0 }) } },
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const TEMPLATE_ID = "tpl-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

const PDF_BYTES = Buffer.from("%PDF-1.4\n%mock-pdf-content-for-tests\n")
const TEXT_BYTES = Buffer.from("just plain text, not a real PDF")

interface FakeFile { bytes: Buffer; name: string; type: string }
function makeFile(bytes: Buffer, name: string, type: string): FakeFile {
  return { bytes, name, type }
}

function buildMultipartBody(fields: Record<string, string>, file?: FakeFile): { body: Buffer; contentType: string } {
  const boundary = "----vitestBoundary" + Math.random().toString(16).slice(2)
  const parts: Buffer[] = []
  for (const [key, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${key}"\r\n\r\n${value}\r\n`))
  }
  if (file) {
    parts.push(Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`
    ))
    parts.push(file.bytes)
    parts.push(Buffer.from("\r\n"))
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`))
  return { body: Buffer.concat(parts), contentType: `multipart/form-data; boundary=${boundary}` }
}

async function callCreateRoute(fields: Record<string, string>, file?: FakeFile) {
  const { POST } = await import("@/app/api/templates/route")
  const { body, contentType } = buildMultipartBody(fields, file)
  const req = new NextRequest("http://localhost/api/templates", {
    method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(body),
  })
  const res = await POST(req)
  return { status: res.status, body: await res.json() }
}

async function callVersionRoute(templateId: string, file?: FakeFile) {
  const { POST } = await import("@/app/api/templates/[templateId]/versions/route")
  const { body, contentType } = buildMultipartBody({}, file)
  const req = new NextRequest("http://localhost/api/templates/" + templateId + "/versions", {
    method: "POST", headers: { "content-type": contentType }, body: new Uint8Array(body),
  })
  const res = await POST(req, { params: Promise.resolve({ templateId }) })
  return { status: res.status, body: await res.json() }
}

beforeEach(() => {
  vi.clearAllMocks()
  storeFileMock.mockResolvedValue({ key: "templates/org-1/generated-uuid.pdf", url: "/api/files/x", signedUrl: "/api/files/x?sig=1", size: 500, mimeType: "application/pdf", originalName: "form.pdf" })
})

describe("POST /api/templates — initial document template upload", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateCreate.mockImplementation(async ({ data }: any) => ({ id: TEMPLATE_ID, ...data }))
  })

  it("stores a real PDF and creates the template from the storage result — never a client-supplied fileUrl/fileKey", async () => {
    const { status, body } = await callCreateRoute({ name: "CSSP Addendum", formType: "dhs" }, makeFile(PDF_BYTES, "form.pdf", "application/pdf"))

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    expect(storeFileMock).toHaveBeenCalledTimes(1)
    const [storageKey] = storeFileMock.mock.calls[0]
    expect(storageKey).toMatch(/^templates\/org-1\/[a-f0-9-]+\.pdf$/)

    const createData = documentTemplateCreate.mock.calls[0][0].data
    expect(createData.fileUrl).toBe("/api/files/x")
    expect(createData.fileKey).toBe("templates/org-1/generated-uuid.pdf")
    expect(createData.fileSize).toBe(500)
    // packetTypes is deprecated — never written.
    expect(createData).not.toHaveProperty("packetTypes")
  })

  it("rejects a non-PDF upload", async () => {
    const { status, body } = await callCreateRoute({ name: "Bad File" }, makeFile(TEXT_BYTES, "notes.exe", "application/octet-stream"))
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(documentTemplateCreate).not.toHaveBeenCalled()
  })

  it("rejects a PDF-extension file whose bytes don't match the PDF signature", async () => {
    const { status, body } = await callCreateRoute({ name: "Fake PDF" }, makeFile(TEXT_BYTES, "fake.pdf", "application/pdf"))
    expect(status).toBe(400)
    expect(body.error).toMatch(/does not match/i)
    expect(storeFileMock).not.toHaveBeenCalled()
  })

  it("rejects when no file is provided", async () => {
    const { status, body } = await callCreateRoute({ name: "No File" })
    expect(status).toBe(400)
    expect(body.error).toMatch(/no file/i)
  })

  it("rejects a role not permitted to manage templates", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { status } = await callCreateRoute({ name: "X" }, makeFile(PDF_BYTES, "form.pdf", "application/pdf"))
    expect(status).toBe(403)
    expect(storeFileMock).not.toHaveBeenCalled()
  })
})

describe("POST /api/templates/[templateId]/versions — new version upload", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateFindUnique.mockResolvedValue({
      id: TEMPLATE_ID, organizationId: ORG_ID, name: "CSSP Addendum", description: null,
      formType: "dhs", program: null, version: 1, fileUrl: "/api/files/old", fileKey: "templates/org-1/old.pdf",
    })
    documentTemplateCreate.mockImplementation(async ({ data }: any) => ({ id: "tpl-2", ...data }))
  })

  it("stores a distinct real file and creates version+1, leaving the prior row untouched", async () => {
    storeFileMock.mockResolvedValue({ key: "templates/org-1/new-uuid.pdf", url: "/api/files/new", signedUrl: "/api/files/new?sig=1", size: 700, mimeType: "application/pdf", originalName: "form-v2.pdf" })

    const { status, body } = await callVersionRoute(TEMPLATE_ID, makeFile(PDF_BYTES, "form-v2.pdf", "application/pdf"))

    expect(status).toBe(200)
    expect(body.success).toBe(true)
    const createData = documentTemplateCreate.mock.calls[0][0].data
    expect(createData.version).toBe(2)
    expect(createData.previousVersionId).toBe(TEMPLATE_ID)
    expect(createData.status).toBe("draft")
    expect(createData.fileKey).toBe("templates/org-1/new-uuid.pdf")
    // Distinct from the old version's file.
    expect(createData.fileKey).not.toBe("templates/org-1/old.pdf")
    // packetTypes is never copied into the new version.
    expect(createData).not.toHaveProperty("packetTypes")
    // The prior row is never written to by this route — no update call exists at all.
    expect(documentTemplateFindUnique).toHaveBeenCalledTimes(1)
  })

  it("old version's fileKey is unaffected — no update call is ever issued against it", async () => {
    await callVersionRoute(TEMPLATE_ID, makeFile(PDF_BYTES, "form-v2.pdf", "application/pdf"))
    // documentTemplate.update is never mocked/called in this route at all —
    // the old row is read-only here, only a new row is created.
    expect(documentTemplateCreate).toHaveBeenCalledTimes(1)
  })

  it("never touches PacketTemplateDocument/PacketDocument — existing references to the old version stay on the old id", async () => {
    // packetTemplateDocument/packetDocument are deliberately not mocked in
    // this suite's db mock at all — if the route touched either table, this
    // call would throw (cannot read property of undefined). A clean 200
    // proves neither table was ever referenced when creating a new version.
    const { status } = await callVersionRoute(TEMPLATE_ID, makeFile(PDF_BYTES, "form-v2.pdf", "application/pdf"))
    expect(status).toBe(200)
    const createData = documentTemplateCreate.mock.calls[0][0].data
    // The new row is a distinct id — anything still pointing at TEMPLATE_ID
    // (old id) in PacketTemplateDocument/PacketDocument is left exactly as-is.
    expect(createData).not.toHaveProperty("id")
  })

  it("rejects a non-PDF version upload", async () => {
    const { status, body } = await callVersionRoute(TEMPLATE_ID, makeFile(TEXT_BYTES, "notes.exe", "application/octet-stream"))
    expect(status).toBe(400)
    expect(body.success).toBe(false)
    expect(documentTemplateCreate).not.toHaveBeenCalled()
  })

  it("rejects a version upload for a template belonging to a different organization", async () => {
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { status, body } = await callVersionRoute(TEMPLATE_ID, makeFile(PDF_BYTES, "form-v2.pdf", "application/pdf"))
    expect(status).toBe(403)
    expect(body.success).toBe(false)
    expect(documentTemplateCreate).not.toHaveBeenCalled()
    expect(storeFileMock).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent template", async () => {
    documentTemplateFindUnique.mockResolvedValue(null)
    const { status, body } = await callVersionRoute("does-not-exist", makeFile(PDF_BYTES, "form-v2.pdf", "application/pdf"))
    expect(status).toBe(404)
    expect(body.error).toMatch(/not found/i)
  })

  it("rejects a role not permitted to manage templates", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { status } = await callVersionRoute(TEMPLATE_ID, makeFile(PDF_BYTES, "form-v2.pdf", "application/pdf"))
    expect(status).toBe(403)
    expect(documentTemplateFindUnique).not.toHaveBeenCalled()
  })
})
