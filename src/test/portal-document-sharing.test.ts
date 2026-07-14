import { describe, it, expect, vi, beforeEach } from "vitest"

const packetDocumentFindUnique = vi.fn()
const packetDocumentUpdate = vi.fn()
const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const requireDocumentAccessMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: {
      findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a),
      update: (...a: unknown[]) => packetDocumentUpdate(...a),
    },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/live-authorization", () => ({ requireDocumentAccess: (...a: unknown[]) => requireDocumentAccessMock(...a) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/storage", () => ({ signStaffFileUrl: vi.fn() }))
vi.mock("@/lib/validation", () => ({ validate: vi.fn(), saveFieldsSchema: {}, addFieldSchema: {} }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const DOC_ID = "doc-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireDocumentAccessMock.mockResolvedValue({ userId: STAFF_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
})

describe("setPacketDocumentPortalVisibility", () => {
  it("allows an authorized staff role to share a document and records portalVisibleAt/sharedByUserId", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")
    packetDocumentFindUnique.mockResolvedValue({ id: DOC_ID, packetId: "packet-1", packet: { organizationId: ORG_ID } })
    packetDocumentUpdate.mockImplementation(async ({ data }: any) => ({ id: DOC_ID, ...data }))

    const { setPacketDocumentPortalVisibility } = await import("@/lib/actions/documents")
    const result = await setPacketDocumentPortalVisibility(DOC_ID, { portalVisible: true, portalAccessLevel: "VIEW" })

    expect(result.success).toBe(true)
    const updateData = packetDocumentUpdate.mock.calls[0][0].data
    expect(updateData.portalVisible).toBe(true)
    expect(updateData.portalAccessLevel).toBe("VIEW")
    expect(updateData.sharedByUserId).toBe(STAFF_ID)
    expect(updateData.portalVisibleAt).toBeInstanceOf(Date)

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("DOCUMENT_PORTAL_VISIBILITY_CHANGED")
    // No PHI (client name, diagnosis, etc.) in metadata — only the boolean/enum state.
    expect(JSON.stringify(auditCall.metadata)).not.toMatch(/firstName|lastName|diagnosis/i)
  })

  it("rejects a staff role not permitted to manage documents", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
    packetDocumentFindUnique.mockResolvedValue({ id: DOC_ID, packetId: "packet-1", packet: { organizationId: ORG_ID } })

    const { setPacketDocumentPortalVisibility } = await import("@/lib/actions/documents")
    const result = await setPacketDocumentPortalVisibility(DOC_ID, { portalVisible: true, portalAccessLevel: "VIEW" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/access denied/i)
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
  })

  it("rejects a document belonging to a different organization", async () => {
    authMock.mockResolvedValue(staffSession())
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
    packetDocumentFindUnique.mockResolvedValue({ id: DOC_ID, packetId: "packet-1", packet: { organizationId: "org-OTHER" } })

    const { setPacketDocumentPortalVisibility } = await import("@/lib/actions/documents")
    const result = await setPacketDocumentPortalVisibility(DOC_ID, { portalVisible: true, portalAccessLevel: "VIEW" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/access denied/i)
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
  })

  it("disabling sharing clears portalVisible, portalAccessLevel, portalVisibleAt, and sharedByUserId immediately", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    packetDocumentFindUnique.mockResolvedValue({ id: DOC_ID, packetId: "packet-1", packet: { organizationId: ORG_ID } })
    packetDocumentUpdate.mockImplementation(async ({ data }: any) => ({ id: DOC_ID, ...data }))

    const { setPacketDocumentPortalVisibility } = await import("@/lib/actions/documents")
    const result = await setPacketDocumentPortalVisibility(DOC_ID, { portalVisible: false })

    expect(result.success).toBe(true)
    const updateData = packetDocumentUpdate.mock.calls[0][0].data
    expect(updateData).toEqual({ portalVisible: false, portalVisibleAt: null, sharedByUserId: null, portalAccessLevel: null })
  })
})
