// Stage 5 Step 5c.3 — portal read models: getPendingPortalSignatureRequest
// (dashboard prompt discovery) and getPortalSignatureRequestForClient (the
// signing ceremony's own detail read). Both are strictly scoped to the
// caller's own, currently active grant via requirePortalClientAccess — a
// request belonging to a different portal user, grant, or client is
// structurally unreachable, never distinguished from "not found".
import { describe, it, expect, vi, beforeEach } from "vitest"

const requirePortalClientAccessMock = vi.fn()
const signatureRequestFindMany = vi.fn()
const signatureRequestFindFirst = vi.fn()
const portalAccessAuthorizationFindFirst = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    signatureRequest: {
      findMany: (...a: unknown[]) => signatureRequestFindMany(...a),
      findFirst: (...a: unknown[]) => signatureRequestFindFirst(...a),
    },
    portalAccessAuthorization: { findFirst: (...a: unknown[]) => portalAccessAuthorizationFindFirst(...a) },
  },
}))
vi.mock("@/lib/portal/auth", () => ({
  requirePortalClientAccess: (...a: unknown[]) => requirePortalClientAccessMock(...a),
}))
vi.mock("@/lib/auth", () => ({ auth: vi.fn() }))
vi.mock("@/lib/permissions", () => ({ requireOrgAccess: vi.fn(), getActiveRole: vi.fn() }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn(), createPortalAuditEvent: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ limiters: { signature: {} }, checkRateLimit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn() }))

const CLIENT_ID = "client-1"
const PORTAL_USER_ID = "portal-user-1"
const GRANT_ID = "grant-1"
const REQUEST_ID = "sig-req-1"

function portalContext(overrides: Record<string, unknown> = {}) {
  return {
    portalUserId: PORTAL_USER_ID, accessId: GRANT_ID, organizationId: "org-1",
    permissions: { canSignDocuments: true },
    ...overrides,
  }
}

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return { id: "auth-1", accessGrantId: GRANT_ID, portalUserId: PORTAL_USER_ID, clientId: CLIENT_ID, revokedAt: null, acceptedAt: new Date("2026-01-01"), effectiveDate: new Date("2026-01-01"), expirationDate: null, ...overrides }
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, status: "sent", signerName: "Jane Doe", consentText: "Consent text.",
    dueDate: null, packetDocumentId: "doc-1",
    packet: { packetType: "initial_intake", client: { firstName: "Ayaan", lastName: "Mohamed" } },
    packetDocument: { documentTemplate: { name: "ISP" } },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requirePortalClientAccessMock.mockResolvedValue(portalContext())
  portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow())
  signatureRequestFindMany.mockResolvedValue([{ id: REQUEST_ID }])
  signatureRequestFindFirst.mockResolvedValue(requestRow())
})

describe("getPendingPortalSignatureRequest", () => {
  it("returns the oldest eligible request id and the total count", async () => {
    signatureRequestFindMany.mockResolvedValue([{ id: REQUEST_ID }, { id: "sig-req-2" }])
    const { getPendingPortalSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await getPendingPortalSignatureRequest(CLIENT_ID)
    expect(result).toEqual({ requestId: REQUEST_ID, count: 2 })
  })

  it("returns null when canSignDocuments is false — before any request query runs", async () => {
    requirePortalClientAccessMock.mockResolvedValue(portalContext({ permissions: { canSignDocuments: false } }))
    const { getPendingPortalSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await getPendingPortalSignatureRequest(CLIENT_ID)
    expect(result).toBeNull()
    expect(signatureRequestFindMany).not.toHaveBeenCalled()
  })

  it("returns null when no accepted, effective authorization exists", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { getPendingPortalSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await getPendingPortalSignatureRequest(CLIENT_ID)
    expect(result).toBeNull()
  })

  it("returns null when there are no open (sent/viewed) requests", async () => {
    signatureRequestFindMany.mockResolvedValue([])
    const { getPendingPortalSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await getPendingPortalSignatureRequest(CLIENT_ID)
    expect(result).toBeNull()
  })

  it("the request query is scoped to exactly the caller's own portalUserId and accessGrantId", async () => {
    const { getPendingPortalSignatureRequest } = await import("@/lib/actions/signatures")
    await getPendingPortalSignatureRequest(CLIENT_ID)
    const where = signatureRequestFindMany.mock.calls[0][0].where
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
    expect(where.accessGrantId).toBe(GRANT_ID)
    expect(where.status.in).toEqual(["sent", "viewed"])
  })
})

describe("getPortalSignatureRequestForClient", () => {
  it("returns the request detail, eligible, when everything checks out", async () => {
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    const result = await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    expect(result?.eligible).toBe(true)
    expect(result?.ineligibleReason).toBeNull()
    expect(result?.signerName).toBe("Jane Doe")
    expect(result?.documentName).toBe("ISP")
  })

  it("scopes the read to exactly the caller's own portalUserId and accessGrantId", async () => {
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    const where = signatureRequestFindFirst.mock.calls[0][0].where
    expect(where.id).toBe(REQUEST_ID)
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
    expect(where.accessGrantId).toBe(GRANT_ID)
  })

  it("returns null for a request belonging to a different portal user/grant — never distinguished from not-found", async () => {
    signatureRequestFindFirst.mockResolvedValue(null)
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    const result = await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    expect(result).toBeNull()
  })

  it("marks ineligible with reason 'not_enabled' when canSignDocuments is false", async () => {
    requirePortalClientAccessMock.mockResolvedValue(portalContext({ permissions: { canSignDocuments: false } }))
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    const result = await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    expect(result?.eligible).toBe(false)
    expect(result?.ineligibleReason).toBe("not_enabled")
    expect(portalAccessAuthorizationFindFirst).not.toHaveBeenCalled()
  })

  it("marks ineligible with reason 'not_authorized' when no accepted, effective authorization exists", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    const result = await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    expect(result?.eligible).toBe(false)
    expect(result?.ineligibleReason).toBe("not_authorized")
  })

  it("computes isOverdue from a past due date", async () => {
    signatureRequestFindFirst.mockResolvedValue(requestRow({ dueDate: new Date("2020-01-01") }))
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    const result = await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    expect(result?.isOverdue).toBe(true)
  })

  it("does not expose organization, grant, or authorization identifiers in the returned view", async () => {
    const { getPortalSignatureRequestForClient } = await import("@/lib/actions/signatures")
    const result = await getPortalSignatureRequestForClient(REQUEST_ID, CLIENT_ID)
    expect(result).not.toHaveProperty("accessGrantId")
    expect(result).not.toHaveProperty("organizationId")
    expect(result).not.toHaveProperty("portalUserId")
  })
})
