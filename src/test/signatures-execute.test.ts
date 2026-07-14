// Stage 5 Step 5a.1 — Staff Signature Execution Foundation.
// executeStaffSignature: authorization, staff-self-signature identity,
// typed-name normalization, consent, status preconditions, applicability,
// atomic transaction, and the conditional-update concurrency gate.
// updateSignatureStatus: "signed" is no longer a reachable transition.
import { describe, it, expect, vi, beforeEach } from "vitest"

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const requirePacketAccessMock = vi.fn()
const createAuditEventMock = vi.fn()
const checkRateLimitMock = vi.fn()
const headersMock = vi.fn()

const signatureRequestFindUnique = vi.fn()
const signatureRequestUpdate = vi.fn()
const signatureRequestCreateMock = vi.fn()
const signatureEventCreatePlain = vi.fn()

const pdfFieldFindUnique = vi.fn()
const pdfFieldUpdate = vi.fn()
const packetDocumentFindUniqueTx = vi.fn()
const signatureRequestUpdateMany = vi.fn()
const signatureEventCreate = vi.fn()
const signatureRequestCountTx = vi.fn()

function makeTx() {
  return {
    pdfField: {
      findUnique: (...a: unknown[]) => pdfFieldFindUnique(...a),
      update: (...a: unknown[]) => pdfFieldUpdate(...a),
    },
    packetDocument: {
      findUnique: (...a: unknown[]) => packetDocumentFindUniqueTx(...a),
    },
    signatureRequest: {
      updateMany: (...a: unknown[]) => signatureRequestUpdateMany(...a),
      count: (...a: unknown[]) => signatureRequestCountTx(...a),
    },
    signatureEvent: {
      create: (...a: unknown[]) => signatureEventCreate(...a),
    },
  }
}
let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    signatureRequest: {
      findUnique: (...a: unknown[]) => signatureRequestFindUnique(...a),
      update: (...a: unknown[]) => signatureRequestUpdate(...a),
      create: (...a: unknown[]) => signatureRequestCreateMock(...a),
    },
    signatureEvent: { create: (...a: unknown[]) => signatureEventCreatePlain(...a) },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/live-authorization", () => ({
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  SIGNATURE_MANAGEMENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"],
  requirePacketAccess: (...a: unknown[]) => requirePacketAccessMock(...a),
  requireClientAccess: vi.fn(),
  requireOrganizationRole: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { signature: {} },
  checkRateLimit: (...a: unknown[]) => checkRateLimitMock(...a),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: () => headersMock() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const STAFF_EMAIL = "case.manager@example.com"
const REQUEST_ID = "sig-req-1"
const PACKET_ID = "pkt-1"
const DOC_ID = "doc-1"
const FIELD_ID = "field-sig-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, email: STAFF_EMAIL, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, organizationId: ORG_ID, packetId: PACKET_ID,
    packetDocumentId: DOC_ID, pdfFieldId: FIELD_ID,
    signerName: "Jane Doe", signerEmail: STAFF_EMAIL, signerRole: "Case Manager", signerType: "staff",
    status: "sent", consentText: "I consent to sign this document electronically.",
    packetDocument: {
      id: DOC_ID, applicabilityStatus: "ACTIVE",
      packet: { organizationId: ORG_ID, status: "awaiting_signature" },
    },
    ...overrides,
  }
}

function fieldRow(overrides: Record<string, unknown> = {}) {
  return { id: FIELD_ID, packetDocumentId: DOC_ID, fieldType: "signature", value: null, ...overrides }
}

function docRowTx(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, applicabilityStatus: "ACTIVE", packetId: PACKET_ID,
    packet: { organizationId: ORG_ID, status: "awaiting_signature" },
    ...overrides,
  }
}

const VALID_INPUT = { signerName: "Jane Doe", consentAccepted: true }

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue({})
  getActiveRoleMock.mockReturnValue("CASE_MANAGER")
  requirePacketAccessMock.mockResolvedValue({
    userId: STAFF_ID, email: STAFF_EMAIL, organizationId: ORG_ID, role: "CASE_MANAGER",
  })
  checkRateLimitMock.mockReturnValue(null)
  headersMock.mockReturnValue({
    get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.5, 70.41.3.18" : name === "user-agent" ? "TestAgent/1.0" : null),
  })

  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))

  signatureRequestFindUnique.mockResolvedValue(requestRow())
  pdfFieldFindUnique.mockResolvedValue(fieldRow())
  packetDocumentFindUniqueTx.mockResolvedValue(docRowTx())
  signatureRequestUpdateMany.mockResolvedValue({ count: 1 })
  signatureEventCreate.mockResolvedValue({ id: "evt-1" })
  signatureRequestCountTx.mockResolvedValue(0)
  pdfFieldUpdate.mockResolvedValue({})
})

describe("executeStaffSignature — happy path", () => {
  it("1. authorized staff executes a valid staff-signature request", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(true)
  })

  it("2. request status becomes signed", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result: any = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.data.status).toBe("signed")
    expect(signatureRequestUpdateMany.mock.calls[0][0].data.status).toBe("signed")
  })

  it("3. signedAt, IP, and user-agent are server-derived, never caller-supplied", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    const updateData = signatureRequestUpdateMany.mock.calls[0][0].data
    expect(updateData.signedAt).toBeInstanceOf(Date)
    expect(updateData.signedIp).toBe("203.0.113.5") // first x-forwarded-for entry only
    expect(updateData.signedUserAgent).toBe("TestAgent/1.0")
  })

  it("4. the linked signature field receives the expected formatted value", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    const fieldUpdate = pdfFieldUpdate.mock.calls[0][0]
    expect(fieldUpdate.where.id).toBe(FIELD_ID)
    expect(fieldUpdate.data.value).toContain("Jane Doe")
    expect(fieldUpdate.data.value).toContain("electronically signed")
    expect(fieldUpdate.data.value).toContain("UTC")
  })

  it("5. a SignatureEvent is created with server-derived metadata", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    const eventData = signatureEventCreate.mock.calls[0][0].data
    expect(eventData.signatureRequestId).toBe(REQUEST_ID)
    expect(eventData.eventType).toBe("signed")
    expect(eventData.ipAddress).toBe("203.0.113.5")
    expect(eventData.userAgent).toBe("TestAgent/1.0")
    expect(eventData.createdById).toBe(STAFF_ID)
  })

  it("6. an audit event is created with SIGNATURE_COMPLETED, atomically via the transaction client", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    const auditCall = createAuditEventMock.mock.calls[0]
    expect(auditCall[0].action).toBe("SIGNATURE_COMPLETED")
    expect(auditCall[0].actorId).toBe(STAFF_ID)
    expect(auditCall[0].organizationId).toBe(ORG_ID)
    expect(auditCall[1]).toBe(currentTx)
  })

  it("returns a remaining-signature result shape with the correct completion flag", async () => {
    signatureRequestCountTx.mockResolvedValue(2)
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result: any = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.data.remainingIncompleteSignatures).toBe(2)
    expect(result.data.allRequiredSignaturesComplete).toBe(false)
  })

  it("reports allRequiredSignaturesComplete=true when no incomplete signatures remain", async () => {
    signatureRequestCountTx.mockResolvedValue(0)
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result: any = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.data.remainingIncompleteSignatures).toBe(0)
    expect(result.data.allRequiredSignaturesComplete).toBe(true)
  })

  it("does not reject solely because signerRole free text differs from the acting user's RBAC role", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ signerRole: "Executive Director" }))
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(true)
  })
})

describe("executeStaffSignature — atomicity", () => {
  it("7. all writes occur inside one transaction call", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(transactionMock).toHaveBeenCalledTimes(1)
  })

  it("aborts the whole transaction and performs no further writes when the conditional update loses", async () => {
    signatureRequestUpdateMany.mockResolvedValue({ count: 0 })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(signatureEventCreate).not.toHaveBeenCalled()
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })
})

describe("executeStaffSignature — validation rejections", () => {
  it("8. missing consent is rejected", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, { signerName: "Jane Doe", consentAccepted: false })
    expect(result.success).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("rejects when the request has no stored consent text", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ consentText: null }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("rejects when stored consent text is blank whitespace", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ consentText: "   " }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("9. missing typed name is rejected", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, { signerName: "", consentAccepted: true })
    expect(result.success).toBe(false)
  })

  it("blank (whitespace-only) typed name is rejected", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, { signerName: "   ", consentAccepted: true })
    expect(result.success).toBe(false)
  })

  it("a non-matching typed name is rejected", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, { signerName: "John Smith", consentAccepted: true })
    expect(result.success).toBe(false)
  })

  it("a normalized match (whitespace/case-insensitive) is accepted", async () => {
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, { signerName: "  jane   doe ", consentAccepted: true })
    expect(result.success).toBe(true)
  })

  it("stores the display-cased, whitespace-normalized typed name, not the stored signerName casing", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ signerName: "JANE DOE" }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    await executeStaffSignature(REQUEST_ID, { signerName: "  jane   doe ", consentAccepted: true })
    expect(pdfFieldUpdate.mock.calls[0][0].data.value).toContain("jane doe")
  })

  it("10. signer-email mismatch is rejected — staff cannot execute on behalf of a differently-named signer", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ signerEmail: "someone.else@example.com" }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("rejects when the request has no signer email on file at all", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ signerEmail: "" }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("accepts a case/whitespace-insensitive email match", async () => {
    requirePacketAccessMock.mockResolvedValue({
      userId: STAFF_ID, email: "  Case.Manager@Example.com  ", organizationId: ORG_ID, role: "CASE_MANAGER",
    })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(true)
  })

  it("11. an unauthorized role is rejected", async () => {
    requirePacketAccessMock.mockResolvedValue({ userId: STAFF_ID, email: STAFF_EMAIL, organizationId: ORG_ID, role: "DSP" })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("12. cross-organization access is rejected", async () => {
    requirePacketAccessMock.mockRejectedValue(new Error("Access denied"))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("13. a cancelled request is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "cancelled" }))
    signatureRequestUpdateMany.mockResolvedValue({ count: 0 })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("14. a declined request is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "declined" }))
    signatureRequestUpdateMany.mockResolvedValue({ count: 0 })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("a pending (never-sent) request is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "pending" }))
    signatureRequestUpdateMany.mockResolvedValue({ count: 0 })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("15. an already-signed request is rejected with a clear, non-destructive error, no new event or field write", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "signed" }))
    signatureRequestUpdateMany.mockResolvedValue({ count: 0 })
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result: any = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/already.*completed/i)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(signatureEventCreate).not.toHaveBeenCalled()
  })

  it("an overdue but still-sent request is still executable (no automatic expiration)", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "sent", dueDate: new Date("2020-01-01") }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(true)
  })

  it("16. a conditionally inactive linked document is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({
      packetDocument: { id: DOC_ID, applicabilityStatus: "CONDITIONALLY_INACTIVE", packet: { organizationId: ORG_ID, status: "awaiting_signature" } },
    }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("rejects when the document is re-verified as conditionally inactive inside the transaction, even if the outer read said active", async () => {
    packetDocumentFindUniqueTx.mockResolvedValue(docRowTx({ applicabilityStatus: "CONDITIONALLY_INACTIVE" }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("rejects when the packet is approved and locked", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({
      packetDocument: { id: DOC_ID, applicabilityStatus: "ACTIVE", packet: { organizationId: ORG_ID, status: "approved" } },
    }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("17. a missing linked field (pdfFieldId null) is rejected", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ pdfFieldId: null }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("rejects when the request is not linked to a packet document at all", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ packetDocumentId: null, packetDocument: null }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("18. a non-signature field type is rejected", async () => {
    pdfFieldFindUnique.mockResolvedValue(fieldRow({ fieldType: "text" }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("rejects when the field found in the transaction does not belong to the linked packet document", async () => {
    pdfFieldFindUnique.mockResolvedValue(fieldRow({ packetDocumentId: "some-other-doc" }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
  })

  it("rejects when the in-transaction document lookup shows a different organization than authorized", async () => {
    packetDocumentFindUniqueTx.mockResolvedValue(docRowTx({ packet: { organizationId: "org-OTHER", status: "awaiting_signature" } }))
    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const result = await executeStaffSignature(REQUEST_ID, VALID_INPUT)
    expect(result.success).toBe(false)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })
})

describe("executeStaffSignature — concurrency", () => {
  it("19. concurrent execution cannot create duplicate events or conflicting values", async () => {
    signatureRequestUpdateMany
      .mockResolvedValueOnce({ count: 1 }) // first caller wins
      .mockResolvedValueOnce({ count: 0 }) // second caller loses

    const { executeStaffSignature } = await import("@/lib/actions/signatures")
    const [first, second] = await Promise.all([
      executeStaffSignature(REQUEST_ID, VALID_INPUT),
      executeStaffSignature(REQUEST_ID, VALID_INPUT),
    ])

    const results = [first, second]
    expect(results.filter((r) => r.success).length).toBe(1)
    expect(results.filter((r) => !r.success).length).toBe(1)
    expect(signatureEventCreate).toHaveBeenCalledTimes(1)
    expect(pdfFieldUpdate).toHaveBeenCalledTimes(1)
  })
})

describe("updateSignatureStatus — signed is no longer reachable", () => {
  it("20. generic updateSignatureStatus cannot bypass execution requirements to set signed", async () => {
    const { updateSignatureStatus } = await import("@/lib/actions/signatures")
    authMock.mockResolvedValue(staffSession())
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "sent" }))
    // Bypassing static typing the way a stale/compromised caller might.
    const result = await updateSignatureStatus(REQUEST_ID, "signed" as any)
    expect(result.success).toBe(false)
    expect(signatureRequestUpdate).not.toHaveBeenCalled()
  })

  it("21. existing non-signing status transitions remain unchanged: pending -> sent", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "pending" }))
    signatureRequestUpdate.mockResolvedValue({})
    signatureEventCreatePlain.mockResolvedValue({ id: "evt-x" })
    const { updateSignatureStatus } = await import("@/lib/actions/signatures")
    const result = await updateSignatureStatus(REQUEST_ID, "sent")
    expect(result.success).toBe(true)
    expect(signatureRequestUpdate).toHaveBeenCalledWith({ where: { id: REQUEST_ID }, data: { status: "sent" } })
  })

  it("sent -> viewed remains unchanged", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "sent" }))
    signatureRequestUpdate.mockResolvedValue({})
    signatureEventCreatePlain.mockResolvedValue({ id: "evt-x" })
    const { updateSignatureStatus } = await import("@/lib/actions/signatures")
    const result = await updateSignatureStatus(REQUEST_ID, "viewed")
    expect(result.success).toBe(true)
  })

  it("-> declined remains unchanged, including declineReason metadata handling", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "sent" }))
    signatureRequestUpdate.mockResolvedValue({})
    signatureEventCreatePlain.mockResolvedValue({ id: "evt-x" })
    const { updateSignatureStatus } = await import("@/lib/actions/signatures")
    const result = await updateSignatureStatus(REQUEST_ID, "declined", { declineReason: "Signer unavailable" })
    expect(result.success).toBe(true)
    expect(signatureRequestUpdate.mock.calls[0][0].data.declineReason).toBe("Signer unavailable")
  })

  it("-> cancelled remains unchanged", async () => {
    signatureRequestFindUnique.mockResolvedValue(requestRow({ status: "pending" }))
    signatureRequestUpdate.mockResolvedValue({})
    signatureEventCreatePlain.mockResolvedValue({ id: "evt-x" })
    const { updateSignatureStatus } = await import("@/lib/actions/signatures")
    const result = await updateSignatureStatus(REQUEST_ID, "cancelled")
    expect(result.success).toBe(true)
  })
})
