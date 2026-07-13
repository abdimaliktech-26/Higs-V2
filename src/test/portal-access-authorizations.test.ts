// Stage 5 Step 5b.1 — Portal Signing Authorization Foundation.
// createPortalAccessAuthorization / getPortalAccessAuthorizations /
// revokePortalAccessAuthorization / setPortalSignPermission. Staff-facing
// only — no portal consent-acceptance or portal signing exists yet.
import { describe, it, expect, vi, beforeEach } from "vitest"

const portalClientAccessFindUnique = vi.fn()
const portalClientAccessUpdate = vi.fn()
const supportingDocumentFindUnique = vi.fn()
const portalAccessAuthorizationCreate = vi.fn()
const portalAccessAuthorizationFindFirst = vi.fn()
const portalAccessAuthorizationFindMany = vi.fn()
const portalAccessAuthorizationFindUnique = vi.fn()
const clientFindUnique = vi.fn()

const authorizationUpdateManyTx = vi.fn()
const portalClientAccessUpdateTx = vi.fn()

const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

function makeTx() {
  return {
    portalAccessAuthorization: { updateMany: (...a: unknown[]) => authorizationUpdateManyTx(...a) },
    portalClientAccess: { update: (...a: unknown[]) => portalClientAccessUpdateTx(...a) },
  }
}
let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    portalClientAccess: {
      findUnique: (...a: unknown[]) => portalClientAccessFindUnique(...a),
      update: (...a: unknown[]) => portalClientAccessUpdate(...a),
    },
    supportingDocument: { findUnique: (...a: unknown[]) => supportingDocumentFindUnique(...a) },
    portalAccessAuthorization: {
      create: (...a: unknown[]) => portalAccessAuthorizationCreate(...a),
      findFirst: (...a: unknown[]) => portalAccessAuthorizationFindFirst(...a),
      findMany: (...a: unknown[]) => portalAccessAuthorizationFindMany(...a),
      findUnique: (...a: unknown[]) => portalAccessAuthorizationFindUnique(...a),
    },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const CLIENT_ID = "client-0000001"
const PORTAL_USER_ID = "pu-1"
const GRANT_ID = "grant-0000001"

function staffUser(overrides: Record<string, unknown> = {}) {
  return { id: STAFF_ID, isSuperAdmin: false, activeOrganizationId: ORG_ID, memberships: [], ...overrides }
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID, portalUserId: PORTAL_USER_ID, clientId: CLIENT_ID, organizationId: ORG_ID,
    status: "ACTIVE", revokedAt: null, expiresAt: null, canSignDocuments: false,
    ...overrides,
  }
}

function authorizationInput(overrides: Record<string, unknown> = {}) {
  return {
    accessGrantId: GRANT_ID,
    authorityType: "LEGAL_GUARDIAN",
    consentText: "I have reviewed and verified this individual's legal authority to sign on the client's behalf.",
    consentVersion: "v1",
    effectiveDate: "2026-01-01",
    ...overrides,
  }
}

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth-1", clientId: CLIENT_ID, portalUserId: PORTAL_USER_ID, accessGrantId: GRANT_ID,
    grantedByUserId: STAFF_ID, authorityType: "LEGAL_GUARDIAN", scope: { type: "CLIENT_WIDE" },
    effectiveDate: new Date("2026-01-01"), expirationDate: null, supportingDocumentId: null,
    consentText: "I consent.", consentVersion: "v1",
    acceptedAt: null, acceptedIp: null, acceptedUserAgent: null,
    revokedAt: null, revokedByUserId: null, createdAt: new Date("2026-01-01"),
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireOrgAccessMock.mockResolvedValue(staffUser())
  getActiveRoleMock.mockReturnValue("ORG_ADMIN")
  portalClientAccessFindUnique.mockResolvedValue(grantRow())
  portalAccessAuthorizationFindFirst.mockResolvedValue(null)
  portalAccessAuthorizationCreate.mockResolvedValue(authorizationRow())
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
  authorizationUpdateManyTx.mockResolvedValue({ count: 1 })
  portalClientAccessUpdateTx.mockResolvedValue({})
  portalClientAccessUpdate.mockResolvedValue(grantRow({ canSignDocuments: true }))
})

describe("createPortalAccessAuthorization", () => {
  it("1. approved staff can create a pending authorization", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(true)
  })

  it("2. acceptedAt remains null", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await createPortalAccessAuthorization(authorizationInput())
    const createData = portalAccessAuthorizationCreate.mock.calls[0][0].data
    expect(createData.acceptedAt).toBeUndefined()
  })

  it("3. acceptedIp and acceptedUserAgent remain null/unset", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await createPortalAccessAuthorization(authorizationInput())
    const createData = portalAccessAuthorizationCreate.mock.calls[0][0].data
    expect(createData.acceptedIp).toBeUndefined()
    expect(createData.acceptedUserAgent).toBeUndefined()
  })

  it("4. canSignDocuments remains false — this action never touches the grant", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await createPortalAccessAuthorization(authorizationInput())
    expect(portalClientAccessUpdate).not.toHaveBeenCalled()
  })

  it("5. organization, client, portal user, and grant relationships are server-derived from the access grant", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await createPortalAccessAuthorization(authorizationInput())
    const createData = portalAccessAuthorizationCreate.mock.calls[0][0].data
    expect(createData.clientId).toBe(CLIENT_ID)
    expect(createData.portalUserId).toBe(PORTAL_USER_ID)
    expect(createData.accessGrantId).toBe(GRANT_ID)
    expect(createData.grantedByUserId).toBe(STAFF_ID)
    expect(createData.scope).toEqual({ type: "CLIENT_WIDE" })
  })

  it("6. unauthorized staff role is rejected", async () => {
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(false)
    expect(portalAccessAuthorizationCreate).not.toHaveBeenCalled()
  })

  it("7. cross-organization access is rejected", async () => {
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(false)
  })

  it("8. a revoked access grant is rejected", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ status: "REVOKED", revokedAt: new Date() }))
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(false)
  })

  it("8b. a nonexistent access grant is rejected", async () => {
    portalClientAccessFindUnique.mockResolvedValue(null)
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(false)
  })

  it("9. missing consent text is rejected", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput({ consentText: "" }))
    expect(result.success).toBe(false)
  })

  it("10. missing consent version is rejected", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput({ consentVersion: "" }))
    expect(result.success).toBe(false)
  })

  it("11. an invalid date range (expiration before/at effective date) is rejected", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput({ effectiveDate: "2026-06-01", expirationDate: "2026-01-01" }))
    expect(result.success).toBe(false)
  })

  it("12. a mismatched supporting document (different client) is rejected", async () => {
    supportingDocumentFindUnique.mockResolvedValue({ id: "doc-1", organizationId: ORG_ID, clientId: "some-other-client" })
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput({ supportingDocumentId: "doc-1" }))
    expect(result.success).toBe(false)
  })

  it("12b. a valid, matching supporting document is accepted", async () => {
    supportingDocumentFindUnique.mockResolvedValue({ id: "doc-1", organizationId: ORG_ID, clientId: CLIENT_ID })
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput({ supportingDocumentId: "doc-1" }))
    expect(result.success).toBe(true)
    expect(portalAccessAuthorizationCreate.mock.calls[0][0].data.supportingDocumentId).toBe("doc-1")
  })

  it("13. a conflicting active or pending authorization is rejected", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow())
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(false)
  })

  it("a new authorization is allowed after a prior one was revoked", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null) // the revoked one is excluded by the query itself
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await createPortalAccessAuthorization(authorizationInput())
    expect(result.success).toBe(true)
  })

  it("14. one portal user can receive separate authorizations for different clients (no cross-client conflict)", async () => {
    portalClientAccessFindUnique.mockResolvedValueOnce(grantRow({ id: "grant-000000A", clientId: "client-A" }))
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const first = await createPortalAccessAuthorization(authorizationInput({ accessGrantId: "grant-000000A" }))
    expect(first.success).toBe(true)

    portalClientAccessFindUnique.mockResolvedValueOnce(grantRow({ id: "grant-000000B", clientId: "client-B" }))
    const second = await createPortalAccessAuthorization(authorizationInput({ accessGrantId: "grant-000000B" }))
    expect(second.success).toBe(true)
  })

  it("15. creating an authorization never creates portal acceptance on behalf of the user (audit metadata carries no acceptance claim)", async () => {
    const { createPortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await createPortalAccessAuthorization(authorizationInput())
    expect(createAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: "PORTAL_ACCESS_AUTHORIZATION_CREATED" }))
    const metadata = createAuditEventMock.mock.calls[0][0].metadata
    expect(metadata.acceptedAt).toBeUndefined()
  })
})

describe("setPortalSignPermission — enablement", () => {
  it("16. staff cannot enable signing before portal acceptance (no authorization at all)", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
    expect(portalClientAccessUpdate).not.toHaveBeenCalled()
  })

  it("17. staff can enable signing after a valid, accepted authorization exists", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow({ acceptedAt: new Date("2026-01-02") }))
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(true)
    expect(portalClientAccessUpdate).toHaveBeenCalledWith({ where: { id: GRANT_ID }, data: { canSignDocuments: true } })
  })

  it("18. a revoked authorization cannot enable signing", async () => {
    // The query itself excludes revoked rows (revokedAt: null in the where
    // clause) — simulating that by returning null, matching what the real
    // query would return for an all-revoked history.
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
  })

  it("19. an expired authorization cannot enable signing", async () => {
    // The query's own expirationDate filter would exclude this row in
    // production; asserting the predicate is applied means the mock
    // reflects "no matching row found" for an expired-only history.
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
  })

  it("19b. the enablement query itself filters on acceptedAt/effectiveDate/expirationDate/revokedAt", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow({ acceptedAt: new Date("2026-01-02") }))
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    await setPortalSignPermission(GRANT_ID, true)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.revokedAt).toBeNull()
    expect(where.acceptedAt).toEqual({ not: null })
    expect(where.effectiveDate).toEqual({ lte: expect.any(Date) })
    expect(where.OR).toEqual([{ expirationDate: null }, { expirationDate: { gt: expect.any(Date) } }])
  })

  it("20. a future-effective authorization cannot enable signing", async () => {
    // Same reasoning as 18/19 — the query's effectiveDate: {lte: now} filter
    // excludes a not-yet-effective row.
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
  })

  it("21. an expired access grant cannot enable signing", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ expiresAt: new Date("2020-01-01") }))
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
    expect(portalAccessAuthorizationFindFirst).not.toHaveBeenCalled()
  })

  it("22. a suspended/revoked/inactive access grant cannot enable signing", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ status: "SUSPENDED" }))
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
  })

  it("23. an authorization belonging to a different portal user is rejected (query scoping)", async () => {
    // The query itself filters on portalUserId matching the grant's own —
    // an authorization for a different portal user simply never matches.
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    await setPortalSignPermission(GRANT_ID, true)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
  })

  it("24. an authorization belonging to a different client is rejected (query scoping)", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    await setPortalSignPermission(GRANT_ID, true)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.clientId).toBe(CLIENT_ID)
  })

  it("25. disabling signing works immediately, with no authorization check at all", async () => {
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, false)
    expect(result.success).toBe(true)
    expect(portalAccessAuthorizationFindFirst).not.toHaveBeenCalled()
    expect(portalClientAccessUpdate).toHaveBeenCalledWith({ where: { id: GRANT_ID }, data: { canSignDocuments: false } })
  })

  it("26. disabling signing does not revoke or otherwise touch the authorization record", async () => {
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    await setPortalSignPermission(GRANT_ID, false)
    expect(portalAccessAuthorizationFindFirst).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("27. enabling creates the expected audit record", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow({ acceptedAt: new Date("2026-01-02") }))
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    await setPortalSignPermission(GRANT_ID, true)
    expect(createAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: "PORTAL_ACCESS_SIGN_PERMISSION_CHANGED", metadata: { canSignDocuments: true } }))
  })

  it("27b. disabling creates the expected audit record", async () => {
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    await setPortalSignPermission(GRANT_ID, false)
    expect(createAuditEventMock).toHaveBeenCalledWith(expect.objectContaining({ action: "PORTAL_ACCESS_SIGN_PERMISSION_CHANGED", metadata: { canSignDocuments: false } }))
  })

  it("unauthorized staff role cannot enable or disable signing", async () => {
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")
    const { setPortalSignPermission } = await import("@/lib/actions/portal-access-authorizations")
    const result = await setPortalSignPermission(GRANT_ID, true)
    expect(result.success).toBe(false)
    expect(portalClientAccessUpdate).not.toHaveBeenCalled()
  })
})

describe("revokePortalAccessAuthorization", () => {
  beforeEach(() => {
    portalAccessAuthorizationFindUnique.mockResolvedValue(authorizationRow())
  })

  it("28. authorized staff can revoke an active authorization", async () => {
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await revokePortalAccessAuthorization("auth-1")
    expect(result.success).toBe(true)
  })

  it("29. revocation preserves the authorization record (no delete call exists anywhere)", async () => {
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await revokePortalAccessAuthorization("auth-1")
    expect(authorizationUpdateManyTx).toHaveBeenCalled()
    // No delete method is even wired into the mocked tx client — a delete
    // call would throw as "not a function", which these tests would surface.
  })

  it("30. revocation records the staff actor and a server-generated timestamp", async () => {
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await revokePortalAccessAuthorization("auth-1")
    const updateData = authorizationUpdateManyTx.mock.calls[0][0].data
    expect(updateData.revokedByUserId).toBe(STAFF_ID)
    expect(updateData.revokedAt).toBeInstanceOf(Date)
  })

  it("31. revocation atomically disables canSignDocuments on the linked grant", async () => {
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await revokePortalAccessAuthorization("auth-1")
    expect(transactionMock).toHaveBeenCalledTimes(1)
    expect(portalClientAccessUpdateTx).toHaveBeenCalledWith({ where: { id: GRANT_ID }, data: { canSignDocuments: false } })
  })

  it("31b. revocation creates a PORTAL_ACCESS_AUTHORIZATION_REVOKED audit event", async () => {
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await revokePortalAccessAuthorization("auth-1")
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PORTAL_ACCESS_AUTHORIZATION_REVOKED", targetId: "auth-1" }),
      expect.anything(),
    )
  })

  it("32. repeated revocation is rejected (conditional update, no double-processing)", async () => {
    authorizationUpdateManyTx.mockResolvedValue({ count: 0 })
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await revokePortalAccessAuthorization("auth-1")
    expect(result.success).toBe(false)
    expect(portalClientAccessUpdateTx).not.toHaveBeenCalled()
  })

  it("33. revocation never clears acceptedAt or acceptance metadata", async () => {
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await revokePortalAccessAuthorization("auth-1")
    const updateData = authorizationUpdateManyTx.mock.calls[0][0].data
    expect(updateData).not.toHaveProperty("acceptedAt")
    expect(updateData).not.toHaveProperty("acceptedIp")
    expect(updateData).not.toHaveProperty("acceptedUserAgent")
  })

  it("34. a revoked authorization is never reactivated — no update path sets revokedAt back to null anywhere in this file", async () => {
    // Structural guarantee: revokePortalAccessAuthorization only ever sets
    // revokedAt to a new Date, never null, and no other exported action in
    // this file touches revokedAt at all.
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    await revokePortalAccessAuthorization("auth-1")
    const updateData = authorizationUpdateManyTx.mock.calls[0][0].data
    expect(updateData.revokedAt).not.toBeNull()
  })

  it("cross-organization revocation is rejected", async () => {
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await revokePortalAccessAuthorization("auth-1")
    expect(result.success).toBe(false)
  })

  it("unauthorized staff role cannot revoke", async () => {
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")
    const { revokePortalAccessAuthorization } = await import("@/lib/actions/portal-access-authorizations")
    const result = await revokePortalAccessAuthorization("auth-1")
    expect(result.success).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })
})

describe("Step 5b.1 — regression and scope guards", () => {
  it("35/36. getPortalAccessAuthorizations lists records without touching portal invitation/upload behavior", async () => {
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
    portalAccessAuthorizationFindMany.mockResolvedValue([authorizationRow()])
    const { getPortalAccessAuthorizations } = await import("@/lib/actions/portal-access-authorizations")
    const result = await getPortalAccessAuthorizations(CLIENT_ID)
    expect(result).toHaveLength(1)
  })

  it("39. no portal consent-acceptance action exists in this module", async () => {
    const mod = await import("@/lib/actions/portal-access-authorizations")
    expect((mod as any).acceptPortalAccessAuthorization).toBeUndefined()
  })

  it("40. no portal signing action exists in this module", async () => {
    const mod = await import("@/lib/actions/portal-access-authorizations")
    expect((mod as any).executePortalSignature).toBeUndefined()
  })
})
