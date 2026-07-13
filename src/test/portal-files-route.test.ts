// @vitest-environment node
//
// Forced to the Node environment (matching src/test/portal-upload-route.test.ts)
// since this route has no DOM dependency and NextRequest/streaming behave
// more accurately there.
//
// Step 4c.4c — direct portal file access must reject a conditionally
// inactive packet document exactly like a non-portal-visible one, before any
// storage fetch, for both view and download, and a genuinely valid signed
// URL (correct signature, unexpired) must not bypass that check. The real
// signPortalFileUrl/verifyPortalFileUrl (from @/lib/storage) are used
// unmocked so signed URLs in these tests are indistinguishable from
// production ones — only getFileStream (actual storage I/O) is mocked.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { NextRequest } from "next/server"

const portalSessionFindUnique = vi.fn()
const portalClientAccessFindFirst = vi.fn()
const clientFindUnique = vi.fn()
const packetDocumentFindUnique = vi.fn()
const supportingDocumentFindUnique = vi.fn()
const getFileStreamMock = vi.fn()

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
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a) },
    supportingDocument: { findUnique: (...a: unknown[]) => supportingDocumentFindUnique(...a) },
  },
}))
vi.mock("next/headers", () => ({ cookies: async () => cookiesMock }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { portalFileAccess: { check: () => ({ allowed: true, remaining: 60, retryAfter: 0, total: 60, resetAt: 0 }) } },
}))
vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>()
  return { ...actual, getFileStream: (...a: unknown[]) => getFileStreamMock(...a) }
})

const ORG_ID = "org-1"
const CLIENT_ID = "client-0000001"
const PACKET_DOC_ID = "pd-1"
const SUPPORTING_DOC_ID = "sd-1"
const PORTAL_USER_ID = "pu-1"

function activeAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1", organizationId: ORG_ID, accessRole: "GUARDIAN", relationship: "Mother",
    canViewDocuments: true, canUploadDocuments: false, canSignDocuments: false,
    canViewAppointments: false, canMessageCareTeam: false, canManageOtherGuardians: false,
    ...overrides,
  }
}

function packetDocumentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKET_DOC_ID, portalVisible: true, applicabilityStatus: "ACTIVE", portalAccessLevel: "VIEW_AND_DOWNLOAD",
    packet: { clientId: CLIENT_ID },
    versions: [{ fileKey: "packet-docs/v1.pdf" }],
    documentTemplate: { name: "ISP" },
    ...overrides,
  }
}

function supportingDocumentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: SUPPORTING_DOC_ID, portalVisible: true, portalAccessLevel: "VIEW_AND_DOWNLOAD",
    clientId: CLIENT_ID, fileKey: "supporting/v1.pdf", title: "ID Card",
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

async function callRoute(docType: string, docId: string, mode: "view" | "download") {
  const { signPortalFileUrl } = await import("@/lib/storage")
  const { GET } = await import("@/app/api/portal-files/[docType]/[docId]/route")
  const signedPath = signPortalFileUrl(docType as any, docId, mode)
  const req = new NextRequest(`http://localhost${signedPath}`)
  const res = await GET(req, { params: Promise.resolve({ docType, docId }) })
  return res
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
  clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
  getFileStreamMock.mockResolvedValue({
    stream: { readFile: async () => Buffer.from("%PDF-1.4 mock content") },
    mimeType: "application/pdf",
    size: 22,
  })
})

describe("portal-files route — Step 4c.4c: applicability enforcement", () => {
  it("1. an active, portal-visible packet document can be viewed under valid authorization", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow())

    const res = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(res.status).toBe(200)
    expect(getFileStreamMock).toHaveBeenCalledWith("packet-docs/v1.pdf")
  })

  it("2. an active, portal-visible packet document can be downloaded under valid authorization", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ portalAccessLevel: "VIEW_AND_DOWNLOAD" }))

    const res = await callRoute("packet_document", PACKET_DOC_ID, "download")
    expect(res.status).toBe(200)
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/)
  })

  it("3. a conditionally inactive packet document returns the same 404 as a non-portal-visible document", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))

    const inactiveRes = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(inactiveRes.status).toBe(404)
    const inactiveBody = await inactiveRes.text()

    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ portalVisible: false }))
    const notVisibleRes = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(notVisibleRes.status).toBe(404)
    const notVisibleBody = await notVisibleRes.text()

    expect(inactiveBody).toBe(notVisibleBody)
  })

  it("4. the conditionally inactive guard applies to view mode", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))

    const res = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(res.status).toBe(404)
  })

  it("5. the conditionally inactive guard applies to download mode", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))

    const res = await callRoute("packet_document", PACKET_DOC_ID, "download")
    expect(res.status).toBe(404)
  })

  it("6. a genuinely valid, correctly signed, unexpired URL cannot bypass the applicability check", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))

    // callRoute builds the request via the real signPortalFileUrl — the
    // signature itself is entirely valid; only the document's own
    // persisted applicabilityStatus determines the outcome.
    const res = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(res.status).toBe(404)
    expect(getFileStreamMock).not.toHaveBeenCalled()
  })

  it("7. a non-portal-visible document retains the existing rejection behavior", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ portalVisible: false }))

    const res = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(res.status).toBe(404)
  })

  it("8. supporting-document requests are unaffected by the applicability guard", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    supportingDocumentFindUnique.mockResolvedValue(supportingDocumentRow())

    const res = await callRoute("supporting_document", SUPPORTING_DOC_ID, "view")
    expect(res.status).toBe(200)
    expect(getFileStreamMock).toHaveBeenCalledWith("supporting/v1.pdf")
  })

  it("9. existing role/client/token/access-level checks remain unchanged", async () => {
    // No session at all.
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow())
    const unauthenticated = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(unauthenticated.status).toBe(401)

    // Valid session, but no active client access grant.
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(null)
    const noAccess = await callRoute("packet_document", PACKET_DOC_ID, "view")
    expect(noAccess.status).toBe(404)

    // Valid session and access, but VIEW-only document requesting download.
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ portalAccessLevel: "VIEW" }))
    const downloadDenied = await callRoute("packet_document", PACKET_DOC_ID, "download")
    expect(downloadDenied.status).toBe(403)

    // Tampered signature.
    const { GET } = await import("@/app/api/portal-files/[docType]/[docId]/route")
    const req = new NextRequest(`http://localhost/api/portal-files/packet_document/${PACKET_DOC_ID}?mode=view&expires=${Date.now() + 60000}&sig=deadbeef`)
    const tampered = await GET(req, { params: Promise.resolve({ docType: "packet_document", docId: PACKET_DOC_ID }) })
    expect(tampered.status).toBe(403)
  })

  it("10. no storage fetch or stream occurs after the route determines a packet document is conditionally inactive", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))

    await callRoute("packet_document", PACKET_DOC_ID, "view")
    await callRoute("packet_document", PACKET_DOC_ID, "download")

    expect(getFileStreamMock).not.toHaveBeenCalled()
  })
})
