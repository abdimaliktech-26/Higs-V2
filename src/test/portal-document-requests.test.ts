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

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

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
    portalClientAccess: {
      findUnique: (...a: unknown[]) => portalClientAccessFindUnique(...a),
      update: (...a: unknown[]) => portalClientAccessUpdate(...a),
    },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/portal/auth", () => ({ requirePortalClientAccess: vi.fn() }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
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
