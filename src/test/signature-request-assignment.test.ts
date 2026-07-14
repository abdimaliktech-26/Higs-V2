// Stage 5 Step 5c.1 — Portal Signature Request Assignment and Actor
// Foundation. Covers createSignatureRequest's new discriminated-union
// contract (STAFF vs PORTAL, all-or-nothing portal assignment,
// server-derived portal signer identity, required document/field/consent
// linkage) and the two new eligibility read actions. No portal execution
// exists yet — executeStaffSignature itself is untouched and covered
// separately by signatures-execute.test.ts.
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const checkRateLimitMock = vi.fn()

const packetFindUnique = vi.fn()
const packetDocumentFindUnique = vi.fn()
const pdfFieldFindUnique = vi.fn()
const pdfFieldFindMany = vi.fn()
const signatureRequestFindFirst = vi.fn()
const signatureRequestCreate = vi.fn()
const clientFindUnique = vi.fn()
const portalClientAccessFindUnique = vi.fn()
const portalClientAccessFindMany = vi.fn()
const portalAccessAuthorizationFindFirst = vi.fn()
const portalAccessAuthorizationFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packet: { findUnique: (...a: unknown[]) => packetFindUnique(...a) },
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a) },
    pdfField: {
      findUnique: (...a: unknown[]) => pdfFieldFindUnique(...a),
      findMany: (...a: unknown[]) => pdfFieldFindMany(...a),
    },
    signatureRequest: {
      findFirst: (...a: unknown[]) => signatureRequestFindFirst(...a),
      create: (...a: unknown[]) => signatureRequestCreate(...a),
    },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    portalClientAccess: {
      findUnique: (...a: unknown[]) => portalClientAccessFindUnique(...a),
      findMany: (...a: unknown[]) => portalClientAccessFindMany(...a),
    },
    portalAccessAuthorization: {
      findFirst: (...a: unknown[]) => portalAccessAuthorizationFindFirst(...a),
      findMany: (...a: unknown[]) => portalAccessAuthorizationFindMany(...a),
    },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { signature: {} },
  checkRateLimit: (...a: unknown[]) => checkRateLimitMock(...a),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-0000001"
const STAFF_ID = "staff-0000001"
const PACKET_ID = "packet-0000001"
const CLIENT_ID = "client-0000001"
const DOC_ID = "doc-0000001"
const FIELD_ID = "field-0000001"
const GRANT_ID = "grant-0000001"
const PORTAL_USER_ID = "portal-user-0001"
const CONTACT_ID = "contact-0000001"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, email: "case.manager@example.com", activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function packetRow(overrides: Record<string, unknown> = {}) {
  return { id: PACKET_ID, organizationId: ORG_ID, clientId: CLIENT_ID, status: "in_progress", ...overrides }
}

function packetDocumentRow(overrides: Record<string, unknown> = {}) {
  return { id: DOC_ID, packetId: PACKET_ID, applicabilityStatus: "ACTIVE", ...overrides }
}

function pdfFieldRow(overrides: Record<string, unknown> = {}) {
  return { id: FIELD_ID, packetDocumentId: DOC_ID, fieldType: "signature", name: "Guardian Signature", pageNumber: 1, isRequired: true, ...overrides }
}

function grantRow(overrides: Record<string, unknown> = {}) {
  return {
    id: GRANT_ID, organizationId: ORG_ID, clientId: CLIENT_ID, portalUserId: PORTAL_USER_ID,
    status: "ACTIVE", revokedAt: null, expiresAt: null, canSignDocuments: true,
    clientContactId: CONTACT_ID, accessRole: "GUARDIAN",
    portalUser: { email: "guardian@example.com", status: "ACTIVE", emailVerifiedAt: new Date("2026-01-01") },
    clientContact: { firstName: "Jane", lastName: "Doe", relationship: "Mother", clientId: CLIENT_ID },
    ...overrides,
  }
}

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth-0000001", accessGrantId: GRANT_ID, portalUserId: PORTAL_USER_ID, clientId: CLIENT_ID,
    revokedAt: null, acceptedAt: new Date("2026-01-15"), effectiveDate: new Date("2026-01-01"), expirationDate: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue(staffSession().user)
  getActiveRoleMock.mockReturnValue("CASE_MANAGER")
  checkRateLimitMock.mockReturnValue(undefined)
  packetFindUnique.mockResolvedValue(packetRow())
  packetDocumentFindUnique.mockResolvedValue(packetDocumentRow())
  pdfFieldFindUnique.mockResolvedValue(pdfFieldRow())
  signatureRequestFindFirst.mockResolvedValue(null)
  signatureRequestCreate.mockResolvedValue({ id: "sig-req-new" })
  portalClientAccessFindUnique.mockResolvedValue(grantRow())
  portalAccessAuthorizationFindFirst.mockResolvedValue(authorizationRow())
})

function staffPayload(overrides: Record<string, unknown> = {}) {
  return {
    assignmentType: "STAFF", packetId: PACKET_ID, packetDocumentId: DOC_ID, pdfFieldId: FIELD_ID,
    consentText: "I consent to sign electronically.",
    signerName: "John Doe", signerEmail: "john@example.com", signerRole: "Client", signerType: "client",
    ...overrides,
  }
}

function portalPayload(overrides: Record<string, unknown> = {}) {
  return {
    assignmentType: "PORTAL", packetId: PACKET_ID, packetDocumentId: DOC_ID, pdfFieldId: FIELD_ID,
    consentText: "I consent to sign electronically.", accessGrantId: GRANT_ID,
    ...overrides,
  }
}

describe("createSignatureRequest — staff-assigned", () => {
  it("creates a staff request when document/field/consent are all valid", async () => {
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(true)
    const data = signatureRequestCreate.mock.calls[0][0].data
    expect(data.portalUserId).toBeNull()
    expect(data.accessGrantId).toBeNull()
    expect(data.clientContactId).toBeNull()
    expect(data.packetDocumentId).toBe(DOC_ID)
    expect(data.pdfFieldId).toBe(FIELD_ID)
    expect(data.consentText).toBe("I consent to sign electronically.")
  })

  it("rejects when the selected document does not belong to the packet", async () => {
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ packetId: "other-packet" }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(false)
    expect(signatureRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects when the document is conditionally inactive", async () => {
    packetDocumentFindUnique.mockResolvedValue(packetDocumentRow({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(false)
  })

  it("rejects when the selected field does not belong to the selected document", async () => {
    pdfFieldFindUnique.mockResolvedValue(pdfFieldRow({ packetDocumentId: "other-doc" }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(false)
  })

  it("rejects when the selected field is not a signature field", async () => {
    pdfFieldFindUnique.mockResolvedValue(pdfFieldRow({ fieldType: "text" }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(false)
  })

  it("rejects when the field already has an open signature request", async () => {
    signatureRequestFindFirst.mockResolvedValue({ id: "existing-open-request" })
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(false)
    expect(signatureRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects an unauthorized staff role", async () => {
    getActiveRoleMock.mockReturnValue("UNKNOWN_ROLE")
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(staffPayload())
    expect(result.success).toBe(false)
  })
})

describe("createSignatureRequest — portal-assigned", () => {
  it("creates a portal request and derives every signer field from the grant, never the caller", async () => {
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(true)
    const data = signatureRequestCreate.mock.calls[0][0].data
    expect(data.portalUserId).toBe(PORTAL_USER_ID)
    expect(data.accessGrantId).toBe(GRANT_ID)
    expect(data.clientContactId).toBe(CONTACT_ID)
    expect(data.signerName).toBe("Jane Doe")
    expect(data.signerEmail).toBe("guardian@example.com")
    expect(data.signerType).toBe("portal")
  })

  it("all three portal fields are populated together, never partially", async () => {
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    await createSignatureRequest(portalPayload())
    const data = signatureRequestCreate.mock.calls[0][0].data
    const populated = [data.portalUserId, data.accessGrantId, data.clientContactId].filter((v) => v !== null)
    expect(populated).toHaveLength(3)
  })

  it("rejects a grant belonging to a different client", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ clientId: "other-client" }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
    expect(signatureRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects a grant belonging to a different organization", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ organizationId: "other-org" }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })

  it("rejects a revoked grant", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ revokedAt: new Date() }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })

  it("rejects an expired grant", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ expiresAt: new Date("2020-01-01") }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })

  it("rejects a grant with canSignDocuments === false", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ canSignDocuments: false }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })

  it("rejects a grant whose portal user is not ACTIVE (e.g. suspended/locked)", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ portalUser: { email: "guardian@example.com", status: "SUSPENDED", emailVerifiedAt: new Date("2026-01-01") } }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
    expect(signatureRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects a grant whose portal user has not verified their email", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ portalUser: { email: "guardian@example.com", status: "ACTIVE", emailVerifiedAt: null } }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
    expect(signatureRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects a grant with no linked ClientContact", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ clientContactId: null, clientContact: null }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })

  it("rejects when the linked contact's own clientId does not match the packet's client (belt-and-suspenders re-check)", async () => {
    portalClientAccessFindUnique.mockResolvedValue(grantRow({ clientContact: { firstName: "Jane", lastName: "Doe", relationship: "Mother", clientId: "some-other-client" } }))
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
    expect(signatureRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects when no accepted, effective authorization exists", async () => {
    portalAccessAuthorizationFindFirst.mockResolvedValue(null)
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })

  it("the authorization lookup uses the exact accepted/effective/non-revoked/non-expired predicate", async () => {
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    await createSignatureRequest(portalPayload())
    const where = portalAccessAuthorizationFindFirst.mock.calls[0][0].where
    expect(where.accessGrantId).toBe(GRANT_ID)
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
    expect(where.revokedAt).toBeNull()
    expect(where.acceptedAt).toEqual({ not: null })
    expect(where.effectiveDate).toHaveProperty("lte")
  })

  it("rejects a nonexistent access grant", async () => {
    portalClientAccessFindUnique.mockResolvedValue(null)
    const { createSignatureRequest } = await import("@/lib/actions/signatures")
    const result = await createSignatureRequest(portalPayload())
    expect(result.success).toBe(false)
  })
})

describe("getEligibleSignatureFields", () => {
  it("queries only signature-type fields on active documents with no open request", async () => {
    pdfFieldFindMany.mockResolvedValue([])
    const { getEligibleSignatureFields } = await import("@/lib/actions/signatures")
    await getEligibleSignatureFields(PACKET_ID)
    const where = pdfFieldFindMany.mock.calls[0][0].where
    expect(where.fieldType).toBe("signature")
    expect(where.packetDocument.applicabilityStatus).toBe("ACTIVE")
    expect(where.signatureRequests.none.status.in).toEqual(["pending", "sent", "viewed"])
  })

  it("returns document name and field context for each eligible field", async () => {
    pdfFieldFindMany.mockResolvedValue([
      { id: FIELD_ID, packetDocumentId: DOC_ID, name: "Guardian Signature", pageNumber: 2, isRequired: true, packetDocument: { documentTemplate: { name: "ISP" } } },
    ])
    const { getEligibleSignatureFields } = await import("@/lib/actions/signatures")
    const result = await getEligibleSignatureFields(PACKET_ID)
    expect(result).toEqual([{ id: FIELD_ID, packetDocumentId: DOC_ID, name: "Guardian Signature", pageNumber: 2, isRequired: true, documentName: "ISP" }])
  })

  it("rejects a nonexistent packet", async () => {
    packetFindUnique.mockResolvedValue(null)
    const { getEligibleSignatureFields } = await import("@/lib/actions/signatures")
    await expect(getEligibleSignatureFields("does-not-exist")).rejects.toThrow("Packet not found")
  })
})

describe("getEligiblePortalSigningGrants", () => {
  beforeEach(() => {
    clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
  })

  it("returns a grant that is active, signing-enabled, contact-linked, and has an effective authorization", async () => {
    portalClientAccessFindMany.mockResolvedValue([grantRow()])
    portalAccessAuthorizationFindMany.mockResolvedValue([{ accessGrantId: GRANT_ID }])
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    const result = await getEligiblePortalSigningGrants(CLIENT_ID)
    expect(result).toEqual([{ accessGrantId: GRANT_ID, portalUserId: PORTAL_USER_ID, email: "guardian@example.com", contactName: "Jane Doe", relationship: "Mother", accessRole: "GUARDIAN" }])
  })

  it("excludes a grant whose portal user is not ACTIVE", async () => {
    portalClientAccessFindMany.mockResolvedValue([grantRow({ portalUser: { email: "guardian@example.com", status: "LOCKED", emailVerifiedAt: new Date("2026-01-01") } })])
    portalAccessAuthorizationFindMany.mockResolvedValue([{ accessGrantId: GRANT_ID }])
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    const result = await getEligiblePortalSigningGrants(CLIENT_ID)
    expect(result).toEqual([])
  })

  it("excludes a grant whose portal user has not verified their email", async () => {
    portalClientAccessFindMany.mockResolvedValue([grantRow({ portalUser: { email: "guardian@example.com", status: "ACTIVE", emailVerifiedAt: null } })])
    portalAccessAuthorizationFindMany.mockResolvedValue([{ accessGrantId: GRANT_ID }])
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    const result = await getEligiblePortalSigningGrants(CLIENT_ID)
    expect(result).toEqual([])
  })

  it("excludes a grant with no effective authorization even if otherwise eligible", async () => {
    portalClientAccessFindMany.mockResolvedValue([grantRow()])
    portalAccessAuthorizationFindMany.mockResolvedValue([])
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    const result = await getEligiblePortalSigningGrants(CLIENT_ID)
    expect(result).toEqual([])
  })

  it("the initial grant query itself excludes canSignDocuments===false and missing clientContactId", async () => {
    portalClientAccessFindMany.mockResolvedValue([])
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    await getEligiblePortalSigningGrants(CLIENT_ID)
    const where = portalClientAccessFindMany.mock.calls[0][0].where
    expect(where.canSignDocuments).toBe(true)
    expect(where.clientContactId).toEqual({ not: null })
    expect(where.status).toBe("ACTIVE")
    expect(where.revokedAt).toBeNull()
  })

  it("returns an empty array with zero authorization queries when there are no candidate grants", async () => {
    portalClientAccessFindMany.mockResolvedValue([])
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    const result = await getEligiblePortalSigningGrants(CLIENT_ID)
    expect(result).toEqual([])
    expect(portalAccessAuthorizationFindMany).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent client", async () => {
    clientFindUnique.mockResolvedValue(null)
    const { getEligiblePortalSigningGrants } = await import("@/lib/actions/signatures")
    await expect(getEligiblePortalSigningGrants("does-not-exist")).rejects.toThrow("Client not found")
  })
})

// Superseded by Step 5c.2 (approved): executePortalSignature now exists in
// this module, exercised in full by signatures-execute-portal.test.ts. This
// test now confirms only that it's a real function — the "no execution"
// guarantee from Step 5c.1 doesn't apply once 5c.2 is in scope.
describe("Step 5c.2 — portal execution now exists", () => {
  it("executePortalSignature is a real function", async () => {
    const mod = await import("@/lib/actions/signatures")
    expect(typeof (mod as any).executePortalSignature).toBe("function")
  })
})
