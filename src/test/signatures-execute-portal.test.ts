// Stage 5 Step 5c.2 — Portal Signature Execution Action.
// executePortalSignature: structured grant/portal-user/contact/client
// authorization (never signerEmail alone), live permission and
// authorization checks, a second in-transaction re-verification of every
// revocable precondition, the shared executeSignatureTransaction helper
// (also exercised via the staff-signing regression in
// signatures-execute.test.ts, which must remain fully green), portal actor
// recording on SignatureEvent, and both the portal-facing and staff-facing
// audit writes.
import { describe, it, expect, vi, beforeEach } from "vitest"

const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const authMock = vi.fn()
const requirePortalPermissionMock = vi.fn()
const createAuditEventMock = vi.fn()
const createPortalAuditEventMock = vi.fn()
const checkRateLimitMock = vi.fn()
const headersMock = vi.fn()

const signatureRequestFindUnique = vi.fn()
const clientContactFindUnique = vi.fn()
const portalAccessAuthorizationFindFirst = vi.fn()

const pdfFieldFindUnique = vi.fn()
const pdfFieldUpdate = vi.fn()
const packetDocumentFindUniqueTx = vi.fn()
const signatureRequestUpdateMany = vi.fn()
const signatureEventCreate = vi.fn()
const signatureRequestCountTx = vi.fn()
const portalClientAccessFindUniqueTx = vi.fn()
const portalAccessAuthorizationFindFirstTx = vi.fn()
const clientContactFindUniqueTx = vi.fn()
const signatureRequestFindUniqueTx = vi.fn()

function makeTx() {
  return {
    pdfField: {
      findUnique: (...a: unknown[]) => pdfFieldFindUnique(...a),
      update: (...a: unknown[]) => pdfFieldUpdate(...a),
    },
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUniqueTx(...a) },
    signatureRequest: {
      updateMany: (...a: unknown[]) => signatureRequestUpdateMany(...a),
      count: (...a: unknown[]) => signatureRequestCountTx(...a),
      findUnique: (...a: unknown[]) => signatureRequestFindUniqueTx(...a),
    },
    signatureEvent: { create: (...a: unknown[]) => signatureEventCreate(...a) },
    portalClientAccess: { findUnique: (...a: unknown[]) => portalClientAccessFindUniqueTx(...a) },
    portalAccessAuthorization: { findFirst: (...a: unknown[]) => portalAccessAuthorizationFindFirstTx(...a) },
    clientContact: { findUnique: (...a: unknown[]) => clientContactFindUniqueTx(...a) },
  }
}
let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    signatureRequest: { findUnique: (...a: unknown[]) => signatureRequestFindUnique(...a) },
    clientContact: { findUnique: (...a: unknown[]) => clientContactFindUnique(...a) },
    portalAccessAuthorization: { findFirst: (...a: unknown[]) => portalAccessAuthorizationFindFirst(...a) },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/portal/auth", () => ({
  requirePortalPermission: (...a: unknown[]) => requirePortalPermissionMock(...a),
}))
vi.mock("@/lib/audit", () => ({
  createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a),
  createPortalAuditEvent: (...a: unknown[]) => createPortalAuditEventMock(...a),
}))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { signature: {} },
  checkRateLimit: (...a: unknown[]) => checkRateLimitMock(...a),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: () => headersMock() }))

const ORG_ID = "org-1"
const CLIENT_ID = "client-1"
const PORTAL_USER_ID = "portal-user-1"
const OTHER_PORTAL_USER_ID = "portal-user-2"
const GRANT_ID = "grant-1"
const OTHER_GRANT_ID = "grant-2"
const CONTACT_ID = "contact-1"
const REQUEST_ID = "sig-req-portal-1"
const PACKET_ID = "pkt-1"
const DOC_ID = "doc-1"
const FIELD_ID = "field-sig-1"

function portalContext(overrides: Record<string, unknown> = {}) {
  return {
    portalUserId: PORTAL_USER_ID, email: "guardian@example.com", sessionId: "session-1",
    accessId: GRANT_ID, organizationId: ORG_ID, accessRole: "GUARDIAN", relationship: "Mother",
    permissions: {
      canViewDocuments: true, canUploadDocuments: false, canSignDocuments: true,
      canViewAppointments: true, canMessageCareTeam: true, canManageOtherGuardians: false,
    },
    ...overrides,
  }
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, organizationId: ORG_ID, packetId: PACKET_ID,
    packetDocumentId: DOC_ID, pdfFieldId: FIELD_ID,
    signerName: "Jane Doe", signerEmail: "guardian@example.com", signerRole: "GUARDIAN", signerType: "portal",
    status: "sent", consentText: "I consent to sign this document electronically.",
    portalUserId: PORTAL_USER_ID, accessGrantId: GRANT_ID, clientContactId: CONTACT_ID,
    packetDocument: {
      id: DOC_ID, applicabilityStatus: "ACTIVE", packetId: PACKET_ID,
      packet: { clientId: CLIENT_ID, organizationId: ORG_ID, status: "awaiting_signature" },
    },
    ...overrides,
  }
}

function fieldRow(overrides: Record<string, unknown> = {}) {
  return { id: FIELD_ID, packetDocumentId: DOC_ID, fieldType: "signature", value: null, ...overrides }
}

function docRow(overrides: Record<string, unknown> = {}) {
  return { id: DOC_ID, packetId: PACKET_ID, applicabilityStatus: "ACTIVE", packet: { organizationId: ORG_ID, packetId: PACKET_ID, status: "awaiting_signature" }, ...overrides }
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return { id: GRANT_ID, portalUserId: PORTAL_USER_ID, clientId: CLIENT_ID, organizationId: ORG_ID, status: "ACTIVE", revokedAt: null, expiresAt: null, canSignDocuments: true, ...overrides }
}

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return { id: "auth-1", accessGrantId: GRANT_ID, portalUserId: PORTAL_USER_ID, clientId: CLIENT_ID, revokedAt: null, acceptedAt: new Date("2026-01-01"), effectiveDate: new Date("2026-01-01"), expirationDate: null, ...overrides }
}

function contactRow(overrides: Record<string, unknown> = {}) {
  return { id: CONTACT_ID, clientId: CLIENT_ID, firstName: "Jane", lastName: "Doe", ...overrides }
}

function mockHeaders(entries: Record<string, string | undefined> = { "x-forwarded-for": "203.0.113.9", "user-agent": "test-agent" }) {
  headersMock.mockResolvedValue({ get: (key: string) => entries[key] ?? null })
}

function execute(input: { signerName: string; consentAccepted: boolean } = { signerName: "Jane Doe", consentAccepted: true }) {
  return import("@/lib/actions/signatures").then((m) => m.executePortalSignature(REQUEST_ID, input))
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
  mockHeaders()
  checkRateLimitMock.mockReturnValue(undefined)
  requirePortalPermissionMock.mockResolvedValue(portalContext())

  signatureRequestFindUnique.mockResolvedValue(requestRow())
  clientContactFindUnique.mockResolvedValue(contactRow())
  portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow())

  pdfFieldFindUnique.mockResolvedValue(fieldRow())
  packetDocumentFindUniqueTx.mockResolvedValue(docRow())
  signatureRequestUpdateMany.mockResolvedValue({ count: 1 })
  signatureEventCreate.mockResolvedValue({})
  signatureRequestCountTx.mockResolvedValue(0)
  portalClientAccessFindUniqueTx.mockResolvedValue(grantRow())
  portalAccessAuthorizationFindFirstTx.mockResolvedValue(authorizationRow())
  clientContactFindUniqueTx.mockResolvedValue(contactRow())
  signatureRequestFindUniqueTx.mockResolvedValue(requestRow())
})

describe("executePortalSignature — successful execution", () => {
  it("1. correct portal user signs an assigned sent request", async () => {
    const result = await execute()
    expect(result.success).toBe(true)
  })

  it("2. correct portal user signs an assigned viewed request", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "viewed" }))
    const result = await execute()
    expect(result.success).toBe(true)
  })

  it("3. request becomes signed", async () => {
    await execute()
    expect(signatureRequestUpdateMany).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "signed" }) }))
  })

  it("4/5/6. signedAt/IP/user-agent are server-derived", async () => {
    mockHeaders({ "x-forwarded-for": "198.51.100.7, 10.0.0.1", "user-agent": "Mozilla/5.0 test" })
    const result = await execute()
    expect(result.success).toBe(true)
    const updateData = signatureRequestUpdateMany.mock.calls[0][0].data
    expect(updateData.signedAt).toBeInstanceOf(Date)
    expect(updateData.signedIp).toBe("198.51.100.7")
    expect(updateData.signedUserAgent).toBe("Mozilla/5.0 test")
  })

  it("7. PdfField.value uses the existing deterministic formatter — whitespace-normalized typed name, UTC timestamp, no other data", async () => {
    await execute({ signerName: "  Jane   Doe  ", consentAccepted: true })
    const value = pdfFieldUpdate.mock.calls[0][0].data.value as string
    expect(value).toMatch(/^Jane Doe — electronically signed \w+ \d{1,2}, \d{4} at \d{1,2}:\d{2} [AP]M UTC$/)
  })

  it("8/9. SignatureEvent.createdById is null, portalUserId is populated", async () => {
    await execute()
    const data = signatureEventCreate.mock.calls[0][0].data
    expect(data.createdById).toBeNull()
    expect(data.portalUserId).toBe(PORTAL_USER_ID)
  })

  it("10. event metadata identifies portal execution", async () => {
    await execute()
    const data = signatureEventCreate.mock.calls[0][0].data
    expect(data.metadata).toEqual({ method: "portal_signature" })
  })

  it("11. PORTAL_SIGNATURE_SIGNED portal audit event is created", async () => {
    await execute()
    expect(createPortalAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "PORTAL_SIGNATURE_SIGNED", portalUserId: PORTAL_USER_ID, organizationId: ORG_ID, clientId: CLIENT_ID, targetId: REQUEST_ID }),
      expect.anything()
    )
  })

  it("12. staff-facing SIGNATURE_COMPLETED audit event is created without misusing the staff actor FK", async () => {
    await execute()
    expect(createAuditEventMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: "SIGNATURE_COMPLETED", actorId: undefined, organizationId: ORG_ID, targetId: REQUEST_ID }),
      expect.anything()
    )
    const call = createAuditEventMock.mock.calls[0][0]
    expect(call.metadata.portalUserId).toBe(PORTAL_USER_ID)
    expect(call.metadata.accessGrantId).toBe(GRANT_ID)
    expect(call.metadata.method).toBe("portal_signature")
  })

  it("13. remaining-open count is returned correctly", async () => {
    signatureRequestCountTx.mockResolvedValue(2)
    const result = await execute()
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.remainingIncompleteSignatures).toBe(2)
  })

  it("14. all-required-complete result is returned correctly", async () => {
    signatureRequestCountTx.mockResolvedValue(0)
    const result = await execute()
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.allRequiredSignaturesComplete).toBe(true)
  })
})

describe("executePortalSignature — portal assignment and identity", () => {
  it("15. request with null portal-assignment fields is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ portalUserId: null, accessGrantId: null, clientContactId: null }))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(requirePortalPermissionMock).not.toHaveBeenCalled()
  })

  it("16. a partially-assigned portal request is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ clientContactId: null }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("17. a different portal user is rejected", async () => {
    requirePortalPermissionMock.mockResolvedValue(portalContext({ portalUserId: OTHER_PORTAL_USER_ID }))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(signatureRequestUpdateMany).not.toHaveBeenCalled()
  })

  it("18. a different access grant is rejected", async () => {
    requirePortalPermissionMock.mockResolvedValue(portalContext({ accessId: OTHER_GRANT_ID }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("19. a different client is rejected (requirePortalPermission is called with the request's own client, not a caller value)", async () => {
    await execute()
    expect(requirePortalPermissionMock).toHaveBeenCalledWith(CLIENT_ID, "canSignDocuments")
  })

  it("20. a contact mismatch is rejected", async () => {
    clientContactFindUnique.mockResolvedValue(contactRow({ clientId: "other-client" }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("21. reassignment after the read (outer) is rejected via the in-transaction recheck", async () => {
    signatureRequestFindUniqueTx.mockResolvedValue(requestRow({ accessGrantId: OTHER_GRANT_ID }))
    const result = await execute()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/reassigned/)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("22. signer email alone cannot authorize execution — no email comparison exists in this action", async () => {
    requirePortalPermissionMock.mockResolvedValue(portalContext({ portalUserId: OTHER_PORTAL_USER_ID }))
    signatureRequestFindUnique.mockResolvedValue(requestRow({ signerEmail: "guardian@example.com" }))
    const result = await execute()
    expect(result.success).toBe(false)
  })
})

describe("executePortalSignature — permission and authorization", () => {
  it("23. canSignDocuments === false is rejected (via requirePortalPermission itself throwing)", async () => {
    requirePortalPermissionMock.mockRejectedValue(new Error("This permission has not been granted"))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(signatureRequestUpdateMany).not.toHaveBeenCalled()
  })

  it("24. missing authorization is rejected", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("25. unaccepted authorization is rejected (findFirst predicate excludes it, mocked as not found)", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.acceptedAt).toEqual({ not: null })
  })

  it("26. revoked authorization is rejected", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.revokedAt).toBeNull()
  })

  it("27. expired authorization is rejected", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.OR).toEqual([{ expirationDate: null }, { expirationDate: { gt: expect.any(Date) } }])
  })

  it("28. future-effective authorization is rejected", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.effectiveDate).toEqual({ lte: expect.any(Date) })
  })

  it("29/30/31/32. inactive/suspended/revoked/expired grant is rejected (via requirePortalPermission)", async () => {
    requirePortalPermissionMock.mockRejectedValue(new Error("No active access to this client"))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("33/34. inactive or unverified portal user is rejected (via requirePortalPermission)", async () => {
    requirePortalPermissionMock.mockRejectedValue(new Error("Account is not active"))
    const result = await execute()
    expect(result.success).toBe(false)
  })
})

describe("executePortalSignature — consent and typed name", () => {
  it("35. a blank typed name is rejected", async () => {
    const result = await execute({ signerName: "   ", consentAccepted: true })
    expect(result.success).toBe(false)
    expect(requirePortalPermissionMock).toHaveBeenCalled()
    expect(signatureRequestUpdateMany).not.toHaveBeenCalled()
  })

  it("36. normalized matching handles case and repeated whitespace", async () => {
    const result = await execute({ signerName: "  jane    DOE  ", consentAccepted: true })
    expect(result.success).toBe(true)
  })

  it("37. a name mismatch is rejected", async () => {
    const result = await execute({ signerName: "Someone Else", consentAccepted: true })
    expect(result.success).toBe(false)
  })

  it("38. consentAccepted: false is rejected", async () => {
    const result = await execute({ signerName: "Jane Doe", consentAccepted: false })
    expect(result.success).toBe(false)
  })

  it("39. missing stored consent text is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ consentText: "" }))
    const result = await execute()
    expect(result.success).toBe(false)
  })
})

describe("executePortalSignature — request and document integrity", () => {
  it("40/41/42/43. pending/cancelled/declined/already-signed request is rejected", async () => {
    for (const status of ["pending", "cancelled", "declined", "signed"]) {
      signatureRequestFindUnique.mockResolvedValue(requestRow({ status }))
      const result = await execute()
      expect(result.success).toBe(false)
    }
  })

  it("44. a missing linked field is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ pdfFieldId: null }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("45. a non-signature field is rejected (caught inside the shared transaction helper)", async () => {
    pdfFieldFindUnique.mockResolvedValue(fieldRow({ fieldType: "text" }))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(signatureRequestUpdateMany).not.toHaveBeenCalled()
  })

  it("46. a field/document mismatch is rejected", async () => {
    pdfFieldFindUnique.mockResolvedValue(fieldRow({ packetDocumentId: "other-doc" }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("47. a missing linked document is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ packetDocumentId: null, packetDocument: null }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("48. a conditionally inactive document is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ packetDocument: { id: DOC_ID, applicabilityStatus: "CONDITIONALLY_INACTIVE", packetId: PACKET_ID, packet: { clientId: CLIENT_ID, organizationId: ORG_ID, status: "awaiting_signature" } } }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("49. a locked (approved) document/packet is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ packetDocument: { id: DOC_ID, applicabilityStatus: "ACTIVE", packetId: PACKET_ID, packet: { clientId: CLIENT_ID, organizationId: ORG_ID, status: "approved" } } }))
    const result = await execute()
    expect(result.success).toBe(false)
  })

  it("50. an organization/client mismatch is rejected (in-transaction grant re-check)", async () => {
    portalClientAccessFindUniqueTx.mockResolvedValue(grantRow({ organizationId: "other-org" }))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })
})

describe("executePortalSignature — concurrency and races", () => {
  it("51. two simultaneous execution attempts produce exactly one winner", async () => {
    signatureRequestUpdateMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 })
    const [first, second] = await Promise.all([execute(), execute()])
    const results = [first, second]
    expect(results.filter((r) => r.success).length).toBe(1)
    expect(results.filter((r) => !r.success).length).toBe(1)
  })

  it("52/53/54. a losing attempt writes no field value, no signature event, and no audit event", async () => {
    signatureRequestUpdateMany.mockResolvedValue({ count: 0 })
    const result = await execute()
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(signatureEventCreate).not.toHaveBeenCalled()
    expect(createAuditEventMock).not.toHaveBeenCalled()
    expect(createPortalAuditEventMock).not.toHaveBeenCalled()
  })

  it("55. permission disabled between the outer check and the transaction is rejected", async () => {
    portalClientAccessFindUniqueTx.mockResolvedValue(grantRow({ canSignDocuments: false }))
    const result = await execute()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/no longer enabled/)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("56. authorization revoked between the outer check and the transaction is rejected", async () => {
    portalAccessAuthorizationFindFirstTx.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/no longer accepted and effective/)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("57. authorization expires between the outer check and the transaction is rejected", async () => {
    portalAccessAuthorizationFindFirstTx.mockResolvedValue(null)
    const result = await execute()
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("58. grant expires or is revoked between the outer check and the transaction is rejected", async () => {
    portalClientAccessFindUniqueTx.mockResolvedValue(grantRow({ revokedAt: new Date() }))
    const result = await execute()
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toMatch(/no longer active/)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("59. request reassignment before the transaction gate is rejected", async () => {
    signatureRequestFindUniqueTx.mockResolvedValue(requestRow({ portalUserId: OTHER_PORTAL_USER_ID }))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("60. document becomes conditionally inactive before the transaction gate is rejected", async () => {
    packetDocumentFindUniqueTx.mockResolvedValue(docRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))
    const result = await execute()
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })
})

describe("executePortalSignature — the outer checks alone are not treated as sufficient", () => {
  it("the transactional grant re-check runs even though the outer check already passed", async () => {
    await execute()
    expect(portalClientAccessFindUniqueTx).toHaveBeenCalledWith({ where: { id: GRANT_ID } })
  })

  it("the transactional authorization re-check uses the exact same predicate as the outer check", async () => {
    await execute()
    const outerWhere = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    const txWhere = portalAccessAuthorizationFindFirstTx.mock.calls[0][0].where
    expect(txWhere.accessGrantId).toBe(outerWhere.accessGrantId)
    expect(txWhere.acceptedAt).toEqual(outerWhere.acceptedAt)
  })
})

describe("executePortalSignature — accepts no caller-provided identity/context", () => {
  it("the only parameters accepted are requestId and { signerName, consentAccepted }", async () => {
    const mod = await import("@/lib/actions/signatures")
    expect(mod.executePortalSignature.length).toBe(2)
  })
})
