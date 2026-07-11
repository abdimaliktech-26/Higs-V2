import { describe, it, expect, vi, beforeEach } from "vitest"

const documentTemplateFindUnique = vi.fn()
const documentTemplateFindMany = vi.fn()
const documentTemplateUpdate = vi.fn()
const documentTemplateUpdateMany = vi.fn()
const documentTemplateCount = vi.fn()
const packetTemplateCreate = vi.fn()
const packetTemplateDocumentCreate = vi.fn()
const packetTemplateDocumentFindUnique = vi.fn()
const packetTemplateDocumentUpdate = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

function makeTx(overrides: Record<string, any> = {}) {
  return {
    documentTemplate: {
      findMany: (...a: unknown[]) => documentTemplateFindMany(...a),
      updateMany: (...a: unknown[]) => documentTemplateUpdateMany(...a),
      update: (...a: unknown[]) => documentTemplateUpdate(...a),
      ...overrides.documentTemplate,
    },
  }
}
let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    documentTemplate: {
      findUnique: (...a: unknown[]) => documentTemplateFindUnique(...a),
      findMany: (...a: unknown[]) => documentTemplateFindMany(...a),
      update: (...a: unknown[]) => documentTemplateUpdate(...a),
      count: (...a: unknown[]) => documentTemplateCount(...a),
    },
    packetTemplate: { create: (...a: unknown[]) => packetTemplateCreate(...a) },
    packetTemplateDocument: {
      create: (...a: unknown[]) => packetTemplateDocumentCreate(...a),
      findUnique: (...a: unknown[]) => packetTemplateDocumentFindUnique(...a),
      update: (...a: unknown[]) => packetTemplateDocumentUpdate(...a),
    },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const TEMPLATE_ID = "tpl-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
})

const DOC_A = "doc-a"
const DOC_B = "doc-b"

describe("createPacketTemplate — real required/optional flags", () => {
  it("persists each document's own required flag instead of hardcoding true", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateCount.mockResolvedValue(2)
    packetTemplateCreate.mockResolvedValue({ id: "pt-1", name: "Initial Intake" })

    const { createPacketTemplate } = await import("@/lib/actions/templates")
    const result = await createPacketTemplate({
      name: "Initial Intake", packetType: "initial_intake",
      documents: [{ documentTemplateId: DOC_A, required: true }, { documentTemplateId: DOC_B, required: false }],
    })

    expect(result.success).toBe(true)
    expect(packetTemplateDocumentCreate).toHaveBeenCalledTimes(2)
    const dataA = packetTemplateDocumentCreate.mock.calls[0][0].data
    const dataB = packetTemplateDocumentCreate.mock.calls[1][0].data
    expect(dataA).toMatchObject({ documentTemplateId: DOC_A, required: true, sortOrder: 0 })
    expect(dataB).toMatchObject({ documentTemplateId: DOC_B, required: false, sortOrder: 1 })
  })

  it("rejects when a selected document does not belong to the active organization", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    // Only 1 of the 2 requested documents actually belongs to this org.
    documentTemplateCount.mockResolvedValue(1)

    const { createPacketTemplate } = await import("@/lib/actions/templates")
    const result = await createPacketTemplate({
      name: "Initial Intake", packetType: "initial_intake",
      documents: [{ documentTemplateId: DOC_A, required: true }, { documentTemplateId: "doc-OTHER-org", required: true }],
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
    expect(packetTemplateCreate).not.toHaveBeenCalled()
    expect(packetTemplateDocumentCreate).not.toHaveBeenCalled()
  })

  it("creates a packet template with zero documents without erroring", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    packetTemplateCreate.mockResolvedValue({ id: "pt-1", name: "Empty Packet" })

    const { createPacketTemplate } = await import("@/lib/actions/templates")
    const result = await createPacketTemplate({ name: "Empty Packet", packetType: "initial_intake" })

    expect(result.success).toBe(true)
    expect(documentTemplateCount).not.toHaveBeenCalled()
    expect(packetTemplateDocumentCreate).not.toHaveBeenCalled()
  })
})

describe("updatePacketTemplateDocumentRequired", () => {
  it("toggles an existing mapping's required flag", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    packetTemplateDocumentFindUnique.mockResolvedValue({
      id: "ptd-1", required: true, packetTemplate: { id: "pt-1", organizationId: ORG_ID },
    })
    packetTemplateDocumentUpdate.mockResolvedValue({})

    const { updatePacketTemplateDocumentRequired } = await import("@/lib/actions/templates")
    const result = await updatePacketTemplateDocumentRequired("ptd-1", false)

    expect(result.success).toBe(true)
    expect(packetTemplateDocumentUpdate).toHaveBeenCalledWith({ where: { id: "ptd-1" }, data: { required: false } })

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("PACKET_TEMPLATE_DOCUMENT_UPDATED")
    expect(auditCall.metadata).toEqual({ packetTemplateDocumentId: "ptd-1", required: false })
  })

  it("rejects a mapping belonging to a different organization", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    packetTemplateDocumentFindUnique.mockResolvedValue({
      id: "ptd-1", required: true, packetTemplate: { id: "pt-1", organizationId: "org-OTHER" },
    })

    const { updatePacketTemplateDocumentRequired } = await import("@/lib/actions/templates")
    await expect(updatePacketTemplateDocumentRequired("ptd-1", false)).rejects.toThrow("Access denied")
    expect(packetTemplateDocumentUpdate).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent mapping", async () => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    packetTemplateDocumentFindUnique.mockResolvedValue(null)

    const { updatePacketTemplateDocumentRequired } = await import("@/lib/actions/templates")
    const result = await updatePacketTemplateDocumentRequired("does-not-exist", true)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it("rejects a role not permitted to manage templates", async () => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("DSP")

    const { updatePacketTemplateDocumentRequired } = await import("@/lib/actions/templates")
    const result = await updatePacketTemplateDocumentRequired("ptd-1", false)

    expect(result.success).toBe(false)
    expect(packetTemplateDocumentFindUnique).not.toHaveBeenCalled()
  })
})

function templateRow(overrides: Record<string, unknown> = {}) {
  return { id: TEMPLATE_ID, organizationId: ORG_ID, name: "CSSP Addendum", status: "draft", previousVersionId: null, ...overrides }
}

describe("updateTemplateStatus — one active version per family", () => {
  it("activating a version retires the other active version in the same family (previous <- current)", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    // v2 (target) -> previousVersionId v1; v1 has no children besides v2.
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ id: "tpl-v2", previousVersionId: "tpl-v1" }))
    // getVersionFamilyIds traversal: starts at tpl-v2, finds previous tpl-v1 + no children of tpl-v2;
    // then visits tpl-v1, finds no previous + no children besides itself.
    documentTemplateFindUnique
      .mockResolvedValueOnce({ previousVersionId: "tpl-v1" }) // neighbors of tpl-v2
      .mockResolvedValueOnce({ previousVersionId: null }) // neighbors of tpl-v1
    documentTemplateFindMany
      .mockResolvedValueOnce([]) // children of tpl-v2 (none)
      .mockResolvedValueOnce([]) // children of tpl-v1 (none besides tpl-v2, already visited)
    documentTemplateFindMany.mockResolvedValue([{ id: "tpl-v1" }]) // tx.findMany active-siblings lookup fallback

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus("tpl-v2", "active")

    expect(result.success).toBe(true)
    expect(documentTemplateUpdateMany).toHaveBeenCalledWith({ where: { id: { in: ["tpl-v1"] } }, data: { status: "retired" } })
    expect(documentTemplateUpdate).toHaveBeenCalledWith({ where: { id: "tpl-v2" }, data: { status: "active" } })

    const activateCall = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "TEMPLATE_ACTIVATED")
    expect(activateCall![0].metadata.retiredSiblingIds).toEqual(["tpl-v1"])
    const retireCall = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "TEMPLATE_RETIRED")
    expect(retireCall![0].targetId).toBe("tpl-v1")
  })

  it("activating a template with no version family history does not touch any other row", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ previousVersionId: null }))
    documentTemplateFindUnique.mockResolvedValueOnce({ previousVersionId: null })
    documentTemplateFindMany.mockResolvedValueOnce([])

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus(TEMPLATE_ID, "active")

    expect(result.success).toBe(true)
    expect(documentTemplateUpdateMany).not.toHaveBeenCalled()
    expect(documentTemplateUpdate).toHaveBeenCalledWith({ where: { id: TEMPLATE_ID }, data: { status: "active" } })
  })

  it("retiring a template does not touch any sibling version", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ status: "active" }))

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus(TEMPLATE_ID, "retired")

    expect(result.success).toBe(true)
    expect(documentTemplateUpdateMany).not.toHaveBeenCalled()
    expect(documentTemplateUpdate).toHaveBeenCalledWith({ where: { id: TEMPLATE_ID }, data: { status: "retired" } })
    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("TEMPLATE_RETIRED")
  })

  it("rejects a role not permitted to manage templates", async () => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("DSP")

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus(TEMPLATE_ID, "active")

    expect(result.success).toBe(false)
    expect(documentTemplateFindUnique).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent template", async () => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateFindUnique.mockResolvedValueOnce(null)

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus("does-not-exist", "active")

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })
})
