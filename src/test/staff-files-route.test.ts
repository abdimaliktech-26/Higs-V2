import { beforeEach, describe, expect, it, vi } from "vitest"

const verifyStaffFileUrl = vi.fn()
const requireStaffFileAccess = vi.fn()
const getFileStream = vi.fn()
const readFile = vi.fn()
const close = vi.fn()
const rateLimitCheck = vi.fn()
const createAuditEvent = vi.fn()

const { MockStaffAuthorizationError, MockStaffFileNotFoundError } = vi.hoisted(() => ({
  MockStaffAuthorizationError: class extends Error {},
  MockStaffFileNotFoundError: class extends Error {},
}))

vi.mock("@/lib/storage", () => ({
  STAFF_FILE_RESOURCE_TYPES: ["document_template", "packet_document", "pdf_version", "supporting_document"],
  verifyStaffFileUrl: (...args: unknown[]) => verifyStaffFileUrl(...args),
  getFileStream: (...args: unknown[]) => getFileStream(...args),
}))
vi.mock("@/lib/staff-file-access", () => ({
  StaffFileNotFoundError: MockStaffFileNotFoundError,
  requireStaffFileAccess: (...args: unknown[]) => requireStaffFileAccess(...args),
}))
vi.mock("@/lib/live-authorization", () => ({ StaffAuthorizationError: MockStaffAuthorizationError }))
vi.mock("@/lib/rate-limit", () => ({ limiters: { fileAccess: { check: (...args: unknown[]) => rateLimitCheck(...args) } } }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))

const resourceAuthorization = {
  actorId: "staff-1", organizationId: "org-1", fileKey: "documents/file.pdf",
  resourceType: "packet_document", resourceId: "document-1",
}

function request(path: string, query = "expires=999&sig=valid") {
  return { url: `http://localhost/api/files/${path}?${query}` } as any
}

async function callRoute(path: string, query?: string) {
  const { GET } = await import("@/app/api/files/[...path]/route")
  return GET(request(path, query), { params: Promise.resolve({ path: path.split("/") }) })
}

beforeEach(() => {
  vi.clearAllMocks()
  verifyStaffFileUrl.mockReturnValue(true)
  requireStaffFileAccess.mockResolvedValue(resourceAuthorization)
  readFile.mockResolvedValue(Buffer.from("pdf-data"))
  close.mockResolvedValue(undefined)
  getFileStream.mockResolvedValue({ stream: { readFile, close }, mimeType: "application/pdf", size: 8 })
  rateLimitCheck.mockReturnValue({ allowed: true })
  createAuditEvent.mockResolvedValue(undefined)
})

describe("staff file route", () => {
  it("rejects legacy raw storage-key URLs", async () => {
    const response = await callRoute("templates/org-1/file.pdf")
    expect(response.status).toBe(404)
    expect(requireStaffFileAccess).not.toHaveBeenCalled()
  })

  it("rejects an invalid or expired resource signature before database access", async () => {
    verifyStaffFileUrl.mockReturnValue(false)
    const response = await callRoute("packet_document/document-1")
    expect(response.status).toBe(403)
    expect(requireStaffFileAccess).not.toHaveBeenCalled()
  })

  it.each(["document_template", "packet_document", "pdf_version", "supporting_document"])("passes the signed %s resource identity to live authorization", async (resourceType) => {
    const response = await callRoute(`${resourceType}/resource-1`)
    expect(response.status).toBe(200)
    expect(requireStaffFileAccess).toHaveBeenCalledWith(resourceType, "resource-1")
  })

  it("returns 403 when live staff authorization is denied", async () => {
    requireStaffFileAccess.mockRejectedValue(new MockStaffAuthorizationError())
    const response = await callRoute("packet_document/document-1")
    expect(response.status).toBe(403)
    expect(getFileStream).not.toHaveBeenCalled()
  })

  it("returns 404 when the signed database resource no longer exists", async () => {
    requireStaffFileAccess.mockRejectedValue(new MockStaffFileNotFoundError())
    const response = await callRoute("packet_document/document-1")
    expect(response.status).toBe(404)
  })

  it("rate-limits by the live database actor", async () => {
    rateLimitCheck.mockReturnValue({ allowed: false, retryAfter: 12 })
    const response = await callRoute("packet_document/document-1")
    expect(response.status).toBe(429)
    expect(rateLimitCheck).toHaveBeenCalledWith("staff-1")
    expect(response.headers.get("Retry-After")).toBe("12")
  })

  it("reads only the file key resolved from the authorized resource", async () => {
    const response = await callRoute("packet_document/document-1")
    expect(response.status).toBe(200)
    expect(getFileStream).toHaveBeenCalledWith("documents/file.pdf")
    expect(await response.text()).toBe("pdf-data")
    expect(close).toHaveBeenCalledTimes(1)
  })

  it("returns 404 when the authorized database row points to no stored file", async () => {
    getFileStream.mockResolvedValue(null)
    const response = await callRoute("packet_document/document-1")
    expect(response.status).toBe(404)
    expect(createAuditEvent).not.toHaveBeenCalled()
  })

  it("records an organization-scoped download audit without exposing the storage key", async () => {
    await callRoute("packet_document/document-1")
    expect(createAuditEvent).toHaveBeenCalledWith({
      organizationId: "org-1", actorId: "staff-1", action: "DOCUMENT_DOWNLOADED",
      targetType: "packet_document", targetId: "document-1", metadata: { resourceType: "packet_document" },
    })
    expect(JSON.stringify(createAuditEvent.mock.calls)).not.toContain("documents/file.pdf")
  })

  it("marks successful file responses private, uncached, and nosniff", async () => {
    const response = await callRoute("packet_document/document-1")
    expect(response.headers.get("Cache-Control")).toBe("private, no-store")
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff")
    expect(response.headers.get("Content-Type")).toContain("application/pdf")
  })
})
