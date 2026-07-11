import { describe, it, expect, vi, beforeEach } from "vitest"

const clientFindUnique = vi.fn()
const packetFindUnique = vi.fn()
const packetDocumentFindUnique = vi.fn()
const portalDocumentRequestCreate = vi.fn()
const portalDocumentRequestFindUnique = vi.fn()
const portalDocumentRequestUpdate = vi.fn()
const portalDocumentRequestFindMany = vi.fn()
const portalDocumentTimelineEventCreate = vi.fn()
const portalClientAccessFindUnique = vi.fn()
const portalClientAccessUpdate = vi.fn()
const supportingDocumentFindFirst = vi.fn()
const portalDocumentReviewFeedbackFindMany = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const notifyActiveMock = vi.fn()

function makeTx(overrides: Record<string, any> = {}) {
  return {
    portalDocumentRequest: { update: vi.fn(), ...overrides.portalDocumentRequest },
    supportingDocument: { update: vi.fn(), ...overrides.supportingDocument },
    portalDocumentTimelineEvent: { create: vi.fn(), ...overrides.portalDocumentTimelineEvent },
    portalDocumentReviewFeedback: { create: vi.fn(), ...overrides.portalDocumentReviewFeedback },
  }
}
let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    packet: { findUnique: (...a: unknown[]) => packetFindUnique(...a) },
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a) },
    portalDocumentRequest: {
      create: (...a: unknown[]) => portalDocumentRequestCreate(...a),
      findUnique: (...a: unknown[]) => portalDocumentRequestFindUnique(...a),
      update: (...a: unknown[]) => portalDocumentRequestUpdate(...a),
      findMany: (...a: unknown[]) => portalDocumentRequestFindMany(...a),
    },
    portalDocumentTimelineEvent: { create: (...a: unknown[]) => portalDocumentTimelineEventCreate(...a) },
    portalDocumentReviewFeedback: { findMany: (...a: unknown[]) => portalDocumentReviewFeedbackFindMany(...a) },
    portalClientAccess: {
      findUnique: (...a: unknown[]) => portalClientAccessFindUnique(...a),
      update: (...a: unknown[]) => portalClientAccessUpdate(...a),
    },
    supportingDocument: { findFirst: (...a: unknown[]) => supportingDocumentFindFirst(...a) },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/portal/auth", () => ({ requirePortalClientAccess: vi.fn() }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/portal/notifications", () => ({ notifyActivePortalUsersForClient: (...a: unknown[]) => notifyActiveMock(...a) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const CLIENT_ID = "client-0000001"
const REQUEST_ID = "req-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function validRequestInput(overrides: Record<string, unknown> = {}) {
  return {
    clientId: CLIENT_ID,
    title: "Insurance Card (Front & Back)",
    category: "INSURANCE",
    priority: "NORMAL",
    isRequired: true,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
})

describe("createPortalDocumentRequest", () => {
  it("creates a request for the correct tenant/client", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_ID })
    portalDocumentRequestCreate.mockImplementation(async ({ data }: any) => ({ id: REQUEST_ID, ...data }))

    const { createPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await createPortalDocumentRequest(validRequestInput())

    expect(result.success).toBe(true)
    const createData = portalDocumentRequestCreate.mock.calls[0][0].data
    expect(createData.organizationId).toBe(ORG_ID)
    expect(createData.clientId).toBe(CLIENT_ID)
    expect(createData.requestedByUserId).toBe(STAFF_ID)

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PORTAL_DOCUMENT_REQUEST_CREATED")

    expect(notifyActiveMock).toHaveBeenCalledTimes(1)
    const notifyInput = notifyActiveMock.mock.calls[0][0]
    expect(notifyInput.clientId).toBe(CLIENT_ID)
    expect(notifyInput.type).toBe("document_request")
    expect(notifyInput.link).toBe(`/portal/upload?client=${CLIENT_ID}&request=${REQUEST_ID}`)
    expect(notifyInput.metadata).toEqual({ requestId: REQUEST_ID, clientId: CLIENT_ID, event: "document_request" })
  })

  it("rejects a role not permitted to manage documents", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("DSP")
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_ID })

    const { createPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await createPortalDocumentRequest(validRequestInput())

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/insufficient permissions/i)
    expect(portalDocumentRequestCreate).not.toHaveBeenCalled()
    expect(notifyActiveMock).not.toHaveBeenCalled()
  })

  it("rejects a client belonging to a different organization", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: "org-OTHER" })

    const { createPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await createPortalDocumentRequest(validRequestInput())

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/client not found/i)
    expect(portalDocumentRequestCreate).not.toHaveBeenCalled()
  })

  it("rejects a packet that does not belong to the requested client", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_ID })
    packetFindUnique.mockResolvedValue({ clientId: "some-other-client", organizationId: ORG_ID })

    const { createPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await createPortalDocumentRequest(validRequestInput({ packetId: "packet-0000001" }))

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/packet not found/i)
    expect(portalDocumentRequestCreate).not.toHaveBeenCalled()
  })
})

describe("cancelPortalDocumentRequest", () => {
  it("cancels a pending request", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue({ id: REQUEST_ID, organizationId: ORG_ID, clientId: CLIENT_ID, status: "PENDING" })
    portalDocumentRequestUpdate.mockResolvedValue({})

    const { cancelPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await cancelPortalDocumentRequest(REQUEST_ID, "No longer needed")

    expect(result.success).toBe(true)
    const updateData = portalDocumentRequestUpdate.mock.calls[0][0].data
    expect(updateData.status).toBe("CANCELLED")
    expect(updateData.cancelledByUserId).toBe(STAFF_ID)

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PORTAL_DOCUMENT_REQUEST_CANCELLED")
  })

  it("rejects cancelling an already-cancelled request", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue({ id: REQUEST_ID, organizationId: ORG_ID, clientId: CLIENT_ID, status: "CANCELLED" })

    const { cancelPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await cancelPortalDocumentRequest(REQUEST_ID)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already cancelled/i)
    expect(portalDocumentRequestUpdate).not.toHaveBeenCalled()
  })

  it("rejects cancelling an already-approved request", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue({ id: REQUEST_ID, organizationId: ORG_ID, clientId: CLIENT_ID, status: "APPROVED" })

    const { cancelPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await cancelPortalDocumentRequest(REQUEST_ID)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already been approved/i)
    expect(portalDocumentRequestUpdate).not.toHaveBeenCalled()
  })

  it("rejects a request belonging to a different organization", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue({ id: REQUEST_ID, organizationId: "org-OTHER", clientId: CLIENT_ID, status: "PENDING" })

    const { cancelPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await cancelPortalDocumentRequest(REQUEST_ID)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
    expect(portalDocumentRequestUpdate).not.toHaveBeenCalled()
  })
})

describe("getPortalDocumentRequests — tenant isolation", () => {
  it("rejects listing for an organization the staff member cannot access", async () => {
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))

    const { getPortalDocumentRequests } = await import("@/lib/actions/portal-document-requests")
    await expect(getPortalDocumentRequests("org-OTHER")).rejects.toThrow("Access denied")
    expect(portalDocumentRequestFindMany).not.toHaveBeenCalled()
  })

  it("scopes the list query to the given organization and optional client", async () => {
    requireOrgAccessMock.mockResolvedValue({})
    portalDocumentRequestFindMany.mockResolvedValue([])

    const { getPortalDocumentRequests } = await import("@/lib/actions/portal-document-requests")
    await getPortalDocumentRequests(ORG_ID, CLIENT_ID)

    const where = portalDocumentRequestFindMany.mock.calls[0][0].where
    expect(where.organizationId).toBe(ORG_ID)
    expect(where.clientId).toBe(CLIENT_ID)
  })
})

const ACCESS_ID = "access-1"

describe("setPortalUploadPermission", () => {
  it("lets an authorized staff role enable canUploadDocuments", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalClientAccessFindUnique.mockResolvedValue({ id: ACCESS_ID, organizationId: ORG_ID, clientId: CLIENT_ID })
    portalClientAccessUpdate.mockImplementation(async ({ data }: any) => ({ id: ACCESS_ID, ...data }))

    const { setPortalUploadPermission } = await import("@/lib/actions/portal-document-requests")
    const result = await setPortalUploadPermission(ACCESS_ID, true)

    expect(result.success).toBe(true)
    const updateData = portalClientAccessUpdate.mock.calls[0][0].data
    // Only canUploadDocuments is ever touched — no other permission field.
    expect(updateData).toEqual({ canUploadDocuments: true })

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PORTAL_ACCESS_UPLOAD_PERMISSION_CHANGED")
  })

  it("lets an authorized staff role disable canUploadDocuments", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("COMPLIANCE_DIRECTOR")
    portalClientAccessFindUnique.mockResolvedValue({ id: ACCESS_ID, organizationId: ORG_ID, clientId: CLIENT_ID })
    portalClientAccessUpdate.mockImplementation(async ({ data }: any) => ({ id: ACCESS_ID, ...data }))

    const { setPortalUploadPermission } = await import("@/lib/actions/portal-document-requests")
    const result = await setPortalUploadPermission(ACCESS_ID, false)

    expect(result.success).toBe(true)
    expect(portalClientAccessUpdate.mock.calls[0][0].data).toEqual({ canUploadDocuments: false })
  })

  it("rejects a role not authorized to manage portal access permissions (e.g. CASE_MANAGER)", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")

    const { setPortalUploadPermission } = await import("@/lib/actions/portal-document-requests")
    const result = await setPortalUploadPermission(ACCESS_ID, true)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/insufficient permissions/i)
    expect(portalClientAccessUpdate).not.toHaveBeenCalled()
  })

  it("rejects an access grant belonging to a different organization", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalClientAccessFindUnique.mockResolvedValue({ id: ACCESS_ID, organizationId: "org-OTHER", clientId: CLIENT_ID })

    const { setPortalUploadPermission } = await import("@/lib/actions/portal-document-requests")
    const result = await setPortalUploadPermission(ACCESS_ID, true)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
    expect(portalClientAccessUpdate).not.toHaveBeenCalled()
  })

  it("never touches canSignDocuments or canManageOtherGuardians", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalClientAccessFindUnique.mockResolvedValue({ id: ACCESS_ID, organizationId: ORG_ID, clientId: CLIENT_ID })
    portalClientAccessUpdate.mockImplementation(async ({ data }: any) => ({ id: ACCESS_ID, ...data }))

    const { setPortalUploadPermission } = await import("@/lib/actions/portal-document-requests")
    await setPortalUploadPermission(ACCESS_ID, true)

    const updateData = portalClientAccessUpdate.mock.calls[0][0].data
    expect(updateData).not.toHaveProperty("canSignDocuments")
    expect(updateData).not.toHaveProperty("canManageOtherGuardians")
  })
})

function baseRequest(overrides: Record<string, unknown> = {}) {
  return { id: REQUEST_ID, organizationId: ORG_ID, clientId: CLIENT_ID, status: "SUBMITTED", ...overrides }
}

function latestUpload(overrides: Record<string, unknown> = {}) {
  return { id: "supdoc-1", createdAt: new Date(), reviewStatus: "PENDING_REVIEW", ...overrides }
}

describe("markPortalDocumentUnderReview", () => {
  it("transitions SUBMITTED to UNDER_REVIEW and updates the latest upload's reviewStatus", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { markPortalDocumentUnderReview } = await import("@/lib/actions/portal-document-requests")
    const result = await markPortalDocumentUnderReview(REQUEST_ID)

    expect(result.success).toBe(true)
    expect(currentTx.portalDocumentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "UNDER_REVIEW" } }))
    expect(currentTx.supportingDocument.update).toHaveBeenCalledWith(expect.objectContaining({ data: { reviewStatus: "UNDER_REVIEW" } }))
    const eventData = currentTx.portalDocumentTimelineEvent.create.mock.calls[0][0].data
    expect(eventData.eventType).toBe("UNDER_REVIEW")

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PORTAL_DOCUMENT_REQUEST_UNDER_REVIEW")
  })

  it.each(["PENDING", "CANCELLED", "APPROVED", "NEEDS_REPLACEMENT"])("rejects starting review from %s", async (status) => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status }))

    const { markPortalDocumentUnderReview } = await import("@/lib/actions/portal-document-requests")
    const result = await markPortalDocumentUnderReview(REQUEST_ID)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/submitted/i)
  })

  it("rejects when the request has no uploaded document", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(null)

    const { markPortalDocumentUnderReview } = await import("@/lib/actions/portal-document-requests")
    const result = await markPortalDocumentUnderReview(REQUEST_ID)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/no uploaded document/i)
  })

  it("rejects an unauthorized role and a cross-tenant request", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("NURSE")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))

    const { markPortalDocumentUnderReview } = await import("@/lib/actions/portal-document-requests")
    const unauthorized = await markPortalDocumentUnderReview(REQUEST_ID)
    expect(unauthorized.success).toBe(false)

    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED", organizationId: "org-OTHER" }))
    const crossTenant = await markPortalDocumentUnderReview(REQUEST_ID)
    expect(crossTenant.success).toBe(false)
    if (crossTenant.success) return
    expect(crossTenant.error).toMatch(/not found/i)
  })
})

describe("reviewPortalDocumentRequest", () => {
  it("approves from SUBMITTED", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })

    expect(result.success).toBe(true)
    expect(currentTx.portalDocumentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "APPROVED" } }))
    expect(currentTx.supportingDocument.update).toHaveBeenCalledWith(expect.objectContaining({ data: { reviewStatus: "APPROVED" } }))
    // No feedback note supplied — no feedback row should be created.
    expect(currentTx.portalDocumentReviewFeedback.create).not.toHaveBeenCalled()

    expect(notifyActiveMock).toHaveBeenCalledTimes(1)
    const notifyInput = notifyActiveMock.mock.calls[0][0]
    expect(notifyInput.type).toBe("upload_approved")
    expect(notifyInput.clientId).toBe(CLIENT_ID)
    expect(notifyInput.link).toBe(`/portal/documents?client=${CLIENT_ID}`)
    expect(notifyInput.metadata).toEqual({ requestId: REQUEST_ID, clientId: CLIENT_ID, event: "upload_approved" })
    // Passed the transaction client so the notification write commits atomically.
    expect(notifyActiveMock.mock.calls[0][1]).toBe(currentTx)
  })

  it("approves from UNDER_REVIEW", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "UNDER_REVIEW" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })
    expect(result.success).toBe(true)
  })

  it("accepts optional feedback on approval and records it", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED", note: "Looks great, thanks!", category: "OTHER", severity: "SUGGESTED" })

    const feedbackData = currentTx.portalDocumentReviewFeedback.create.mock.calls[0][0].data
    expect(feedbackData.note).toBe("Looks great, thanks!")
    expect(feedbackData.category).toBe("OTHER")
    expect(feedbackData.severity).toBe("SUGGESTED")
    const eventTypes = currentTx.portalDocumentTimelineEvent.create.mock.calls.map((c: any) => c[0].data.eventType)
    expect(eventTypes).toEqual(["APPROVED", "FEEDBACK_ADDED"])
  })

  it("requires feedback for NEEDS_REPLACEMENT from SUBMITTED", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "NEEDS_REPLACEMENT" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/note/i)
    expect(currentTx.portalDocumentRequest.update).not.toHaveBeenCalled()
  })

  it("rejects whitespace-only replacement feedback", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "NEEDS_REPLACEMENT", note: "   " })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/note/i)
  })

  it("requests replacement from UNDER_REVIEW with feedback, category, and severity stored", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "UNDER_REVIEW" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, {
      decision: "NEEDS_REPLACEMENT", note: "Front of insurance card missing", category: "MISSING_PAGES", severity: "REQUIRED",
    })

    expect(result.success).toBe(true)
    expect(currentTx.portalDocumentRequest.update).toHaveBeenCalledWith(expect.objectContaining({ data: { status: "NEEDS_REPLACEMENT" } }))
    expect(currentTx.supportingDocument.update).toHaveBeenCalledWith(expect.objectContaining({ data: { reviewStatus: "NEEDS_REPLACEMENT" } }))
    const feedbackData = currentTx.portalDocumentReviewFeedback.create.mock.calls[0][0].data
    expect(feedbackData.category).toBe("MISSING_PAGES")
    expect(feedbackData.severity).toBe("REQUIRED")
    expect(feedbackData.supportingDocumentId).toBe("supdoc-1")

    expect(notifyActiveMock).toHaveBeenCalledTimes(1)
    const notifyInput = notifyActiveMock.mock.calls[0][0]
    expect(notifyInput.type).toBe("needs_replacement")
    expect(notifyInput.link).toBe(`/portal/upload?client=${CLIENT_ID}&request=${REQUEST_ID}`)
    expect(notifyInput.metadata).toEqual({ requestId: REQUEST_ID, clientId: CLIENT_ID, event: "needs_replacement" })
    // Feedback note text itself must never leak into notification metadata.
    expect(JSON.stringify(notifyInput.metadata)).not.toContain("Front of insurance card missing")
  })

  it.each(["PENDING", "CANCELLED", "APPROVED"])("rejects reviewing a request in %s state", async (status) => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status }))

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/cannot be reviewed/i)
  })

  it("rejects reviewing a request with no uploaded document", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(null)

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const result = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/no uploaded document/i)
  })

  it("resolves the latest upload by createdAt descending, not array order", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload({ id: "supdoc-newest" }))

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })

    expect(supportingDocumentFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { portalRequestId: REQUEST_ID }, orderBy: { createdAt: "desc" } })
    )
    expect(currentTx.supportingDocument.update.mock.calls[0][0].where.id).toBe("supdoc-newest")
  })

  it("rejects an unauthorized role and a cross-tenant request", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("NURSE")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    const unauthorized = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })
    expect(unauthorized.success).toBe(false)

    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED", organizationId: "org-OTHER" }))
    const crossTenant = await reviewPortalDocumentRequest(REQUEST_ID, { decision: "APPROVED" })
    expect(crossTenant.success).toBe(false)
    if (crossTenant.success) return
    expect(crossTenant.error).toMatch(/not found/i)
  })

  it("never exposes raw feedback note text or internal notes in the staff audit event metadata", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    portalDocumentRequestFindUnique.mockResolvedValue(baseRequest({ status: "SUBMITTED" }))
    supportingDocumentFindFirst.mockResolvedValue(latestUpload())

    const { reviewPortalDocumentRequest } = await import("@/lib/actions/portal-document-requests")
    await reviewPortalDocumentRequest(REQUEST_ID, {
      decision: "NEEDS_REPLACEMENT", note: "Sensitive note about the client's condition", category: "OTHER", severity: "REQUIRED",
    })

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PORTAL_DOCUMENT_REQUEST_REVIEWED")
    expect(JSON.stringify(auditCall.metadata)).not.toContain("Sensitive note")
  })
})

describe("getPortalDocumentReviewFeedback — portal-side scoping", () => {
  it("scopes feedback to the correct request and verifies client access", async () => {
    const { requirePortalClientAccess } = await import("@/lib/portal/auth")
    portalDocumentRequestFindUnique.mockResolvedValue({ clientId: CLIENT_ID })
    portalDocumentReviewFeedbackFindMany.mockResolvedValue([])

    const { getPortalDocumentReviewFeedback } = await import("@/lib/actions/portal-document-requests")
    await getPortalDocumentReviewFeedback(REQUEST_ID)

    expect(requirePortalClientAccess).toHaveBeenCalledWith(CLIENT_ID)
    expect(portalDocumentReviewFeedbackFindMany.mock.calls[0][0].where.requestId).toBe(REQUEST_ID)
    // Only client-visible fields are selected — no reviewer-internal identifiers.
    const select = portalDocumentReviewFeedbackFindMany.mock.calls[0][0].select
    expect(select).toEqual({ id: true, note: true, category: true, severity: true, createdAt: true })
  })

  it("rejects when the request does not exist", async () => {
    portalDocumentRequestFindUnique.mockResolvedValue(null)

    const { getPortalDocumentReviewFeedback } = await import("@/lib/actions/portal-document-requests")
    await expect(getPortalDocumentReviewFeedback("does-not-exist")).rejects.toThrow(/not found/i)
  })
})
