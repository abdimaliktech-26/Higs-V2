import { describe, it, expect, vi, beforeEach } from "vitest"

// Stage 5 Step 5b.2 — Portal Consent Acceptance. Covers the two new
// portal-facing exports in portal-access-authorizations.ts:
// getPortalAccessAuthorizationForClient and acceptPortalAccessAuthorization,
// plus the shared derivePortalAuthorizationState() pure function used by
// both the dashboard prompt and the acceptance page.

const portalAccessAuthorizationFindUnique = vi.fn()
const portalAccessAuthorizationFindFirst = vi.fn()
const portalAccessAuthorizationUpdateMany = vi.fn()
const portalClientAccessUpdate = vi.fn()

const requirePortalClientAccessMock = vi.fn()
const createPortalAuditEventMock = vi.fn()
const createAuditEventMock = vi.fn()
const headersMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    portalAccessAuthorization: {
      findUnique: (...a: unknown[]) => portalAccessAuthorizationFindUnique(...a),
      findFirst: (...a: unknown[]) => portalAccessAuthorizationFindFirst(...a),
      updateMany: (...a: unknown[]) => portalAccessAuthorizationUpdateMany(...a),
    },
    portalClientAccess: {
      update: (...a: unknown[]) => portalClientAccessUpdate(...a),
    },
  },
}))
vi.mock("@/lib/portal/auth", () => ({
  requirePortalClientAccess: (...a: unknown[]) => requirePortalClientAccessMock(...a),
}))
vi.mock("@/lib/audit", () => ({
  createPortalAuditEvent: (...a: unknown[]) => createPortalAuditEventMock(...a),
  createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a),
}))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: vi.fn(),
  getActiveRole: vi.fn(),
}))
vi.mock("@/lib/live-authorization", () => ({ requireOrganizationRole: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: (...a: unknown[]) => headersMock(...a) }))

const PORTAL_USER_ID = "portal-user-0001"
const OTHER_PORTAL_USER_ID = "portal-user-0002"
const CLIENT_ID = "client-0000001"
const OTHER_CLIENT_ID = "client-0000002"
const GRANT_ID = "grant-0000001"
const AUTH_ID = "auth-0000001"

function contextRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    portalUserId: PORTAL_USER_ID,
    email: "guardian@example.com",
    sessionId: "session-1",
    accessId: GRANT_ID,
    organizationId: "org-1",
    accessRole: "GUARDIAN",
    relationship: "Mother",
    permissions: {
      canViewDocuments: true, canUploadDocuments: false, canSignDocuments: false,
      canViewAppointments: true, canMessageCareTeam: true, canManageOtherGuardians: false,
    },
    ...overrides,
  }
}

function authorizationRow(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: AUTH_ID,
    clientId: CLIENT_ID,
    portalUserId: PORTAL_USER_ID,
    accessGrantId: GRANT_ID,
    authorityType: "LEGAL_GUARDIAN",
    consentText: "I consent to sign on this client's behalf.",
    consentVersion: "v1",
    effectiveDate: new Date("2026-01-01"),
    expirationDate: null,
    acceptedAt: null,
    revokedAt: null,
    supportingDocumentId: null,
    ...overrides,
  }
}

function mockHeaders(entries: Record<string, string | undefined>) {
  headersMock.mockResolvedValue({ get: (key: string) => entries[key] ?? null })
}

beforeEach(() => {
  vi.clearAllMocks()
  mockHeaders({ "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent" })
  requirePortalClientAccessMock.mockResolvedValue(contextRow())
})

describe("derivePortalAuthorizationState", () => {
  it("returns NONE when no authorization exists", async () => {
    const { derivePortalAuthorizationState } = await import("@/lib/portal/authorization-status")
    expect(derivePortalAuthorizationState(null, new Date())).toBe("NONE")
  })

  it("returns REVOKED when revokedAt is set, even if also accepted", async () => {
    const { derivePortalAuthorizationState } = await import("@/lib/portal/authorization-status")
    const now = new Date("2026-06-01")
    expect(derivePortalAuthorizationState({ acceptedAt: new Date("2026-01-01"), revokedAt: new Date("2026-02-01"), effectiveDate: new Date("2026-01-01"), expirationDate: null }, now)).toBe("REVOKED")
  })

  it("returns EXPIRED when expirationDate has passed and not revoked", async () => {
    const { derivePortalAuthorizationState } = await import("@/lib/portal/authorization-status")
    const now = new Date("2026-06-01")
    expect(derivePortalAuthorizationState({ acceptedAt: null, revokedAt: null, effectiveDate: new Date("2026-01-01"), expirationDate: new Date("2026-05-01") }, now)).toBe("EXPIRED")
  })

  it("returns ACCEPTED when acceptedAt is set and not revoked/expired", async () => {
    const { derivePortalAuthorizationState } = await import("@/lib/portal/authorization-status")
    const now = new Date("2026-06-01")
    expect(derivePortalAuthorizationState({ acceptedAt: new Date("2026-01-15"), revokedAt: null, effectiveDate: new Date("2026-01-01"), expirationDate: null }, now)).toBe("ACCEPTED")
  })

  it("returns PENDING_FUTURE when effectiveDate is in the future", async () => {
    const { derivePortalAuthorizationState } = await import("@/lib/portal/authorization-status")
    const now = new Date("2026-01-01")
    expect(derivePortalAuthorizationState({ acceptedAt: null, revokedAt: null, effectiveDate: new Date("2026-06-01"), expirationDate: null }, now)).toBe("PENDING_FUTURE")
  })

  it("returns PENDING_ACTIONABLE when effective, not accepted, not revoked, not expired", async () => {
    const { derivePortalAuthorizationState } = await import("@/lib/portal/authorization-status")
    const now = new Date("2026-06-01")
    expect(derivePortalAuthorizationState({ acceptedAt: null, revokedAt: null, effectiveDate: new Date("2026-01-01"), expirationDate: null }, now)).toBe("PENDING_ACTIONABLE")
  })
})

describe("getPortalAccessAuthorizationForClient", () => {
  it("1. the correct portal user can view their own pending authorization", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow())
    const { getPortalAccessAuthorizationForClient } = await import("@/lib/actions/portal-access-authorizations")
    const result = await getPortalAccessAuthorizationForClient(CLIENT_ID)
    expect(result?.id).toBe(AUTH_ID)
    expect(requirePortalClientAccessMock).toHaveBeenCalledWith(CLIENT_ID)
  })

  it("2. the query is always scoped to the authenticated caller's own portalUserId and active grant, never an arbitrary one", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { getPortalAccessAuthorizationForClient } = await import("@/lib/actions/portal-access-authorizations")
    await getPortalAccessAuthorizationForClient(CLIENT_ID)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
    expect(where.accessGrantId).toBe(GRANT_ID)
  })

  it("returns null (NONE) when no authorization row exists for this grant", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { getPortalAccessAuthorizationForClient } = await import("@/lib/actions/portal-access-authorizations")
    const result = await getPortalAccessAuthorizationForClient(CLIENT_ID)
    expect(result).toBeNull()
  })

  it("never exposes grantedByUserId or the supporting document itself — only a boolean", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow({ supportingDocumentId: "doc-1" }))
    const { getPortalAccessAuthorizationForClient } = await import("@/lib/actions/portal-access-authorizations")
    const result = await getPortalAccessAuthorizationForClient(CLIENT_ID)
    expect(result?.hasSupportingDocument).toBe(true)
    expect(result).not.toHaveProperty("grantedByUserId")
    expect(result).not.toHaveProperty("supportingDocumentId")
  })

  it("9. an inactive/revoked/expired grant is rejected before any authorization query runs", async () => {
    requirePortalClientAccessMock.mockRejectedValue(new Error("No active access to this client"))
    const { getPortalAccessAuthorizationForClient } = await import("@/lib/actions/portal-access-authorizations")
    await expect(getPortalAccessAuthorizationForClient(CLIENT_ID)).rejects.toThrow("No active access to this client")
    expect(portalAccessAuthorizationFindFirst).not.toHaveBeenCalled()
  })
})

describe("acceptPortalAccessAuthorization", () => {
  beforeEach(() => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(authorizationRow())
    portalAccessAuthorizationUpdateMany.mockResolvedValue({ count: 1 })
  })

  it("3. the correct portal user accepts successfully", async () => {
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(true)
  })

  it("4. acceptedAt/acceptedIp/acceptedUserAgent are exactly the server-derived values", async () => {
    mockHeaders({ "x-forwarded-for": "198.51.100.7, 10.0.0.1", "user-agent": "Mozilla/5.0 test" })
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await acceptPortalAccessAuthorization(AUTH_ID)
    const data = portalAccessAuthorizationUpdateMany.mock.calls[0][0].data
    expect(data.acceptedIp).toBe("198.51.100.7")
    expect(data.acceptedUserAgent).toBe("Mozilla/5.0 test")
    expect(data.acceptedAt).toBeInstanceOf(Date)
  })

  it("5. consent text/version cannot be changed — the write touches only acceptance fields", async () => {
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await acceptPortalAccessAuthorization(AUTH_ID)
    const data = portalAccessAuthorizationUpdateMany.mock.calls[0][0].data
    expect(Object.keys(data).sort()).toEqual(["acceptedAt", "acceptedIp", "acceptedUserAgent"])
  })

  it("6. an already-accepted authorization does not create a duplicate acceptance or audit event", async () => {
    portalAccessAuthorizationUpdateMany.mockResolvedValue({ count: 0 })
    portalAccessAuthorizationFindUnique
      .mockResolvedValueOnce(authorizationRow())
      .mockResolvedValueOnce(authorizationRow({ acceptedAt: new Date("2026-01-10") }))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/already been accepted/)
    expect(createPortalAuditEventMock).not.toHaveBeenCalled()
  })

  it("7. a revoked authorization cannot be accepted", async () => {
    portalAccessAuthorizationUpdateMany.mockResolvedValue({ count: 0 })
    portalAccessAuthorizationFindUnique
      .mockResolvedValueOnce(authorizationRow())
      .mockResolvedValueOnce(authorizationRow({ revokedAt: new Date("2026-01-10") }))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/revoked/)
    expect(createPortalAuditEventMock).not.toHaveBeenCalled()
  })

  it("8. an expired authorization cannot be accepted", async () => {
    portalAccessAuthorizationUpdateMany.mockResolvedValue({ count: 0 })
    const expired = authorizationRow({ expirationDate: new Date("2020-01-01") })
    portalAccessAuthorizationFindUnique.mockResolvedValueOnce(expired).mockResolvedValueOnce(expired)
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/expired/)
  })

  it("a future-effective authorization cannot be accepted", async () => {
    portalAccessAuthorizationUpdateMany.mockResolvedValue({ count: 0 })
    const future = authorizationRow({ effectiveDate: new Date("2099-01-01") })
    portalAccessAuthorizationFindUnique.mockResolvedValueOnce(future).mockResolvedValueOnce(future)
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/not yet available/)
  })

  it("9. an inactive/revoked/expired grant is rejected before any write", async () => {
    requirePortalClientAccessMock.mockRejectedValue(new Error("No active access to this client"))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    expect(portalAccessAuthorizationUpdateMany).not.toHaveBeenCalled()
  })

  it("10. cross-client access is rejected — an authorization for a different client than the caller's active grant", async () => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(authorizationRow({ clientId: OTHER_CLIENT_ID }))
    requirePortalClientAccessMock.mockResolvedValue(contextRow())
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await acceptPortalAccessAuthorization(AUTH_ID)
    expect(requirePortalClientAccessMock).toHaveBeenCalledWith(OTHER_CLIENT_ID)
  })

  it("an authorization belonging to a different portal user is rejected", async () => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(authorizationRow({ portalUserId: OTHER_PORTAL_USER_ID }))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/does not belong to your account/)
    expect(portalAccessAuthorizationUpdateMany).not.toHaveBeenCalled()
  })

  it("an authorization belonging to a different (stale/superseded) grant is rejected", async () => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(authorizationRow({ accessGrantId: "grant-stale-01" }))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    expect(portalAccessAuthorizationUpdateMany).not.toHaveBeenCalled()
  })

  it("11. concurrent acceptance produces exactly one success (the losing call sees count 0)", async () => {
    portalAccessAuthorizationUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    portalAccessAuthorizationFindUnique
      .mockResolvedValueOnce(authorizationRow())
      .mockResolvedValueOnce(authorizationRow())
      .mockResolvedValueOnce(authorizationRow({ acceptedAt: new Date() }))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const [first, second] = await Promise.all([
      acceptPortalAccessAuthorization(AUTH_ID),
      acceptPortalAccessAuthorization(AUTH_ID),
    ])
    const results = [first, second]
    expect(results.filter((r) => r.success).length).toBe(1)
    expect(results.filter((r) => !r.success).length).toBe(1)
  })

  it("12. the concurrency gate's where clause excludes revokedAt, guarding against a revocation race", async () => {
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await acceptPortalAccessAuthorization(AUTH_ID)
    const where = portalAccessAuthorizationUpdateMany.mock.calls[0][0].where
    expect(where.revokedAt).toBeNull()
    expect(where.acceptedAt).toBeNull()
    expect(where.effectiveDate).toHaveProperty("lte")
  })

  it("13. acceptance never touches PortalClientAccess.canSignDocuments", async () => {
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await acceptPortalAccessAuthorization(AUTH_ID)
    expect(portalClientAccessUpdate).not.toHaveBeenCalled()
  })

  it("14. staff (no portal session) cannot call this action — requirePortalClientAccess is the sole gate and its failure aborts everything", async () => {
    requirePortalClientAccessMock.mockRejectedValue(new Error("Not signed in"))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    expect(portalAccessAuthorizationUpdateMany).not.toHaveBeenCalled()
    expect(createPortalAuditEventMock).not.toHaveBeenCalled()
  })

  it("rejects an authorization with no consent text/version configured", async () => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(authorizationRow({ consentText: "   " }))
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization(AUTH_ID)
    expect(result.success).toBe(false)
    expect(portalAccessAuthorizationUpdateMany).not.toHaveBeenCalled()
  })

  it("returns a not-found error for a nonexistent authorization id", async () => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(null)
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await acceptPortalAccessAuthorization("does-not-exist")
    expect(result.success).toBe(false)
    expect(requirePortalClientAccessMock).not.toHaveBeenCalled()
  })

  it("creates exactly one PORTAL_CONSENT_ACCEPTED audit event on success, with the portal user as actor", async () => {
    const { acceptPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await acceptPortalAccessAuthorization(AUTH_ID)
    expect(createPortalAuditEventMock).toHaveBeenCalledTimes(1)
    expect(createPortalAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({
      action: "PORTAL_CONSENT_ACCEPTED",
      portalUserId: PORTAL_USER_ID,
      clientId: CLIENT_ID,
    }))
  })
})

describe("no portal signing action/UI exists in this module", () => {
  it("exports exactly the known staff and portal authorization actions — no document-signing or portal-signing export", async () => {
    const mod = await import("@/lib/actions/portal-access-authorizations")
    const expected = [
      "createPortalAccessAuthorization",
      "getPortalAccessAuthorizations",
      "revokePortalAccessAuthorization",
      "setPortalSignPermission",
      "getPortalAccessAuthorizationForClient",
      "acceptPortalAccessAuthorization",
    ]
    expect(Object.keys(mod).sort()).toEqual(expected.sort())
  })
})
