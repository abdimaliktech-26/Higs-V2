import { describe, it, expect, vi, beforeEach } from "vitest"

const documentTemplateFindUnique = vi.fn()
const documentTemplateFindMany = vi.fn()
const documentTemplateUpdate = vi.fn()
const documentTemplateUpdateMany = vi.fn()
const documentTemplateCount = vi.fn()
const packetTemplateCreate = vi.fn()
const packetTemplateFindUnique = vi.fn()
const packetTemplateDocumentCreate = vi.fn()
const packetTemplateDocumentFindUnique = vi.fn()
const packetTemplateDocumentUpdate = vi.fn()
const packetTemplateDocumentFindMany = vi.fn()
const clientFindUnique = vi.fn()
const packetCreate = vi.fn()
const packetDocumentCreate = vi.fn()
const packetConditionSnapshotCreate = vi.fn()
const documentTemplateFieldFindMany = vi.fn()
const documentTemplateFieldFindFirst = vi.fn()
const templateConditionGroupFindMany = vi.fn()
const pdfFieldCreateMany = vi.fn()

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
    packetConditionSnapshot: { create: (...a: unknown[]) => packetConditionSnapshotCreate(...a), ...overrides.packetConditionSnapshot },
    packet: { create: (...a: unknown[]) => packetCreate(...a), ...overrides.packet },
    packetDocument: { create: (...a: unknown[]) => packetDocumentCreate(...a), ...overrides.packetDocument },
    documentTemplateField: { findMany: (...a: unknown[]) => documentTemplateFieldFindMany(...a), ...overrides.documentTemplateField },
    pdfField: { createMany: (...a: unknown[]) => pdfFieldCreateMany(...a), ...overrides.pdfField },
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
    packetTemplate: {
      create: (...a: unknown[]) => packetTemplateCreate(...a),
      findUnique: (...a: unknown[]) => packetTemplateFindUnique(...a),
    },
    packetTemplateDocument: {
      create: (...a: unknown[]) => packetTemplateDocumentCreate(...a),
      findUnique: (...a: unknown[]) => packetTemplateDocumentFindUnique(...a),
      update: (...a: unknown[]) => packetTemplateDocumentUpdate(...a),
      findMany: (...a: unknown[]) => packetTemplateDocumentFindMany(...a),
    },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    packet: { create: (...a: unknown[]) => packetCreate(...a) },
    packetDocument: { create: (...a: unknown[]) => packetDocumentCreate(...a) },
    packetConditionSnapshot: { create: (...a: unknown[]) => packetConditionSnapshotCreate(...a) },
    documentTemplateField: {
      findMany: (...a: unknown[]) => documentTemplateFieldFindMany(...a),
      findFirst: (...a: unknown[]) => documentTemplateFieldFindFirst(...a),
    },
    templateConditionGroup: { findMany: (...a: unknown[]) => templateConditionGroupFindMany(...a) },
    pdfField: { createMany: (...a: unknown[]) => pdfFieldCreateMany(...a) },
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
  // Safe default for validateTemplateConditions (real, unmocked activation
  // gate now run by updateTemplateStatus's "active" branch) — "no fields, no
  // conditions, trivially valid" unless a specific test overrides this.
  documentTemplateFieldFindMany.mockResolvedValue([])
  templateConditionGroupFindMany.mockResolvedValue([])
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
    // validateTemplateConditions's own template lookup (activation gate) — zero fields, trivially valid.
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
    // validateTemplateConditions's own template lookup (activation gate) — zero fields, trivially valid.
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

  it("blocks activation when the template has broken field-owned conditions", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ previousVersionId: null }))
    // validateTemplateConditions's own lookup, then a real field + a broken condition group.
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ previousVersionId: null }))
    documentTemplateFieldFindMany.mockResolvedValueOnce([{ id: "field-1", fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValueOnce([
      {
        id: "group-1", documentTemplateFieldId: "field-1", packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null,
        conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "ghost_field", operator: "EQUALS", comparisonValue: "x" }],
        childGroups: [],
      },
    ])
    documentTemplateFieldFindFirst.mockResolvedValueOnce(null)

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus(TEMPLATE_ID, "active")

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/broken condition/i)
    expect(documentTemplateUpdate).not.toHaveBeenCalled()
  })

  it("allows activation when the template's conditions are all valid", async () => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ previousVersionId: null }))
    documentTemplateFindUnique.mockResolvedValueOnce(templateRow({ previousVersionId: null }))
    documentTemplateFieldFindMany.mockResolvedValueOnce([{ id: "field-1", fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValueOnce([
      {
        id: "group-1", documentTemplateFieldId: "field-1", packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null,
        conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: "x" }],
        childGroups: [],
      },
    ])
    documentTemplateFindUnique.mockResolvedValueOnce({ previousVersionId: null }) // getVersionFamilyIds neighbor lookup
    documentTemplateFindMany.mockResolvedValueOnce([]) // getVersionFamilyIds children lookup

    const { updateTemplateStatus } = await import("@/lib/actions/templates")
    const result = await updateTemplateStatus(TEMPLATE_ID, "active")

    expect(result.success).toBe(true)
    expect(documentTemplateUpdate).toHaveBeenCalledWith({ where: { id: TEMPLATE_ID }, data: { status: "active" } })
  })
})

const CLIENT_ID = "client-1"
const PACKET_TEMPLATE_ID = "pt-1"
const PACKET_ID = "pkt-1"
const MAPPING_ID = "mapping-1"
const DOC_TEMPLATE_ID = TEMPLATE_ID

function clientRow(overrides: Record<string, unknown> = {}) {
  return { id: CLIENT_ID, organizationId: ORG_ID, dateOfBirth: null, ...overrides }
}

function conditionGroupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grp-1", purpose: "DOCUMENT_INCLUSION", logicOperator: "AND", parentGroupId: null,
    packetTemplateDocumentId: MAPPING_ID, documentTemplateFieldId: null, validationRuleId: null,
    conditions: [], childGroups: [],
    ...overrides,
  }
}

function mappingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: MAPPING_ID, packetTemplateId: PACKET_TEMPLATE_ID, documentTemplateId: DOC_TEMPLATE_ID, required: true, sortOrder: 0,
    conditionGroups: [],
    documentTemplate: { id: DOC_TEMPLATE_ID, organizationId: ORG_ID, fields: [] },
    ...overrides,
  }
}

function packetTemplateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKET_TEMPLATE_ID, organizationId: ORG_ID, packetType: "initial_intake", programId: null, program: null,
    requiredDocs: [{ id: MAPPING_ID, documentTemplateId: DOC_TEMPLATE_ID, required: true, sortOrder: 0, documentTemplate: { id: DOC_TEMPLATE_ID, organizationId: ORG_ID } }],
    ...overrides,
  }
}

function packetTemplateWithDocs(requiredDocs: any[]) {
  return packetTemplateRow({ requiredDocs })
}

describe("createPacket — Step 4c.2a: transactional, condition-aware creation", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(staffSession())
    requireOrgAccessMock.mockResolvedValue({})
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    clientFindUnique.mockResolvedValue(clientRow())
    packetTemplateFindUnique.mockResolvedValue(packetTemplateRow())
    packetTemplateDocumentFindMany.mockResolvedValue([mappingRow()])
    documentTemplateFindUnique.mockResolvedValue({ id: DOC_TEMPLATE_ID, organizationId: ORG_ID })
    documentTemplateFieldFindMany.mockImplementation(async () => [])
    templateConditionGroupFindMany.mockResolvedValue([])
    packetCreate.mockResolvedValue({ id: PACKET_ID })
    packetConditionSnapshotCreate.mockImplementation(async ({ data }: any) => ({ id: "snap-1", ...data }))
    packetDocumentCreate.mockImplementation(async ({ data }: any) => ({ id: `pd-${data.documentTemplateId}`, ...data }))
  })

  describe("field seeding and provenance", () => {
    it("seeds PdfField rows from the mapped DocumentTemplate's field definitions, with full identity provenance", async () => {
      documentTemplateFieldFindMany.mockImplementation(async () => [
        { id: "dtf-1", fieldKey: "client_name", name: "Client Name", fieldType: "text", pageNumber: 1, posX: 40, posY: 30, width: 180, height: 32, isRequired: true, sortOrder: 0 },
        { id: "dtf-2", fieldKey: "guardian_signature", name: "Guardian Signature", fieldType: "signature", pageNumber: 1, posX: 300, posY: 30, width: 200, height: 40, isRequired: true, sortOrder: 1 },
      ])

      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      expect(result.success).toBe(true)
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE" }) })
      expect(pdfFieldCreateMany).toHaveBeenCalledTimes(1)
      const seeded = pdfFieldCreateMany.mock.calls[0][0].data
      expect(seeded).toHaveLength(2)
      expect(seeded[0]).toMatchObject({ name: "Client Name", fieldType: "text", templateFieldKey: "client_name", documentTemplateFieldId: "dtf-1", posX: 40, posY: 30, isRequired: true, source: "template", value: null })
      expect(seeded[1]).toMatchObject({ name: "Guardian Signature", fieldType: "signature", templateFieldKey: "guardian_signature", documentTemplateFieldId: "dtf-2", source: "template" })
    })

    it("every seeded field has source \"template\" and a null value", async () => {
      documentTemplateFieldFindMany.mockImplementation(async () => [
        { id: "dtf-1", fieldKey: "dob", name: "Date of Birth", fieldType: "date", pageNumber: 1, posX: 40, posY: 30, width: 180, height: 32, isRequired: false, sortOrder: 0 },
      ])

      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      const seeded = pdfFieldCreateMany.mock.calls[0][0].data
      expect(seeded.every((f: any) => f.source === "template")).toBe(true)
      expect(seeded.every((f: any) => f.value === null)).toBe(true)
    })

    it("a document template with no field definitions still creates the packet successfully", async () => {
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      expect(result.success).toBe(true)
      expect(pdfFieldCreateMany).not.toHaveBeenCalled()
    })

    it("a packet template with zero mapped documents creates the packet successfully with no field seeding", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateWithDocs([]))
      packetTemplateDocumentFindMany.mockResolvedValue([])

      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      expect(result.success).toBe(true)
      expect(packetDocumentCreate).not.toHaveBeenCalled()
      expect(pdfFieldCreateMany).not.toHaveBeenCalled()
    })

    it("seeds fields independently per mapped document", async () => {
      const MAPPING_B = "mapping-b"
      packetTemplateFindUnique.mockResolvedValue(packetTemplateWithDocs([
        { id: MAPPING_ID, documentTemplateId: "tpl-a", required: true, sortOrder: 0, documentTemplate: { id: "tpl-a", organizationId: ORG_ID } },
        { id: MAPPING_B, documentTemplateId: "tpl-b", required: false, sortOrder: 1, documentTemplate: { id: "tpl-b", organizationId: ORG_ID } },
      ]))
      packetTemplateDocumentFindMany.mockResolvedValue([
        mappingRow({ id: MAPPING_ID, documentTemplateId: "tpl-a", documentTemplate: { id: "tpl-a", organizationId: ORG_ID, fields: [] } }),
        mappingRow({ id: MAPPING_B, documentTemplateId: "tpl-b", required: false, sortOrder: 1, documentTemplate: { id: "tpl-b", organizationId: ORG_ID, fields: [] } }),
      ])
      documentTemplateFieldFindMany.mockImplementation(async ({ where }: any) => {
        const id = typeof where.documentTemplateId === "string" ? where.documentTemplateId : null
        return id === "tpl-a" ? [{ id: "dtf-a1", fieldKey: "a_field", name: "A Field", fieldType: "text", pageNumber: 1, posX: 0, posY: 0, width: 100, height: 20, isRequired: false, sortOrder: 0 }] : []
      })

      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      expect(result.success).toBe(true)
      expect(packetDocumentCreate).toHaveBeenCalledTimes(2)
      expect(pdfFieldCreateMany).toHaveBeenCalledTimes(1)
      expect(pdfFieldCreateMany.mock.calls[0][0].data[0]).toMatchObject({ templateFieldKey: "a_field" })
    })
  })

  describe("ownership verification", () => {
    it("rejects when there is no authenticated session", async () => {
      authMock.mockResolvedValue(null)
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/unauthorized/i)
      expect(clientFindUnique).not.toHaveBeenCalled()
    })

    it("rejects a user with no active organization membership", async () => {
      authMock.mockResolvedValue(staffSession({ activeOrganizationId: undefined }))
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/no org/i)
      expect(clientFindUnique).not.toHaveBeenCalled()
    })

    it("rejects a cross-tenant client", async () => {
      clientFindUnique.mockResolvedValue(clientRow({ organizationId: "org-OTHER" }))
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/not found/i)
      expect(packetCreate).not.toHaveBeenCalled()
    })

    it("rejects a cross-tenant packet template", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateRow({ organizationId: "org-OTHER" }))
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/not found/i)
      expect(packetCreate).not.toHaveBeenCalled()
    })

    it("rejects when a mapped document template belongs to a different organization", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateWithDocs([
        { id: MAPPING_ID, documentTemplateId: DOC_TEMPLATE_ID, required: true, sortOrder: 0, documentTemplate: { id: DOC_TEMPLATE_ID, organizationId: "org-OTHER" } },
      ]))
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/different organization/i)
      expect(packetCreate).not.toHaveBeenCalled()
    })

    it("rejects when the packet template's program belongs to a different organization", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateRow({ programId: "prog-1", program: { id: "prog-1", code: "cadi", organizationId: "org-OTHER" } }))
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/program mismatch/i)
      expect(packetCreate).not.toHaveBeenCalled()
    })

    it("allows a DSP/case-manager role (packet creation is intentionally not restricted to template-management roles)", async () => {
      getActiveRoleMock.mockReturnValue("DSP")
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(true)
    })
  })

  describe("condition validation gate", () => {
    it("blocks creation when the packet template has broken condition definitions", async () => {
      templateConditionGroupFindMany.mockResolvedValueOnce([
        conditionGroupRow({ conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "ghost", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "EQUALS", comparisonValue: "x" }] }),
      ])
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(false)
      if (result.success) return
      expect(result.error).toMatch(/broken condition/i)
      expect(packetCreate).not.toHaveBeenCalled()
      // Safe error only — no comparison values, field values, or client data.
      expect(result.error).not.toContain("ghost")
    })
  })

  describe("snapshot attachment", () => {
    it("creates and attaches an immutable condition snapshot, setting the packet to condition-aware mode", async () => {
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      expect(result.success).toBe(true)
      expect(packetConditionSnapshotCreate).toHaveBeenCalledTimes(1)
      const snapshotData = packetConditionSnapshotCreate.mock.calls[0][0].data
      expect(snapshotData.organizationId).toBe(ORG_ID)
      expect(snapshotData.packetTemplateId).toBe(PACKET_TEMPLATE_ID)
      expect(snapshotData.definition.packetTemplateId).toBe(PACKET_TEMPLATE_ID)

      const packetData = packetCreate.mock.calls[0][0].data
      expect(packetData.conditionSnapshotId).toBe("snap-1")
      expect(packetData.conditionRuntimeVersion).toBe(1)
    })

    it("contains no raw DOB or client field values in the snapshot definition", async () => {
      clientFindUnique.mockResolvedValue(clientRow({ dateOfBirth: new Date("2010-05-01") }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      const snapshotData = packetConditionSnapshotCreate.mock.calls[0][0].data
      expect(JSON.stringify(snapshotData.definition)).not.toContain("2010-05-01")
      expect(snapshotData.definition).not.toHaveProperty("dateOfBirth")
      expect(typeof snapshotData.clientIsMinor).toBe("boolean")
    })
  })

  describe("initial inclusion policy", () => {
    it("no DOCUMENT_INCLUSION condition — creates the document ACTIVE", async () => {
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(true)
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ applicabilityStatus: "ACTIVE" }) })
    })

    it("pseudo-field condition resolves true — creates the document ACTIVE", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateRow({ programId: "prog-1", program: { id: "prog-1", code: "cadi", organizationId: ORG_ID } }))
      packetTemplateDocumentFindMany.mockResolvedValue([
        mappingRow({ conditionGroups: [conditionGroupRow({ conditions: [{ id: "c1", sourceType: "PACKET_PROGRAM_CODE", sourceFieldKey: null, sourcePacketTemplateDocumentId: null, operator: "EQUALS", comparisonValue: "cadi", sortOrder: 0 }] })] }),
      ])
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(true)
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ applicabilityStatus: "ACTIVE" }) })
    })

    it("pseudo-field condition resolves false — document is omitted", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateRow({ programId: "prog-1", program: { id: "prog-1", code: "other", organizationId: ORG_ID } }))
      packetTemplateDocumentFindMany.mockResolvedValue([
        mappingRow({ conditionGroups: [conditionGroupRow({ conditions: [{ id: "c1", sourceType: "PACKET_PROGRAM_CODE", sourceFieldKey: null, sourcePacketTemplateDocumentId: null, operator: "EQUALS", comparisonValue: "cadi", sortOrder: 0 }] })] }),
      ])
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(true)
      expect(packetDocumentCreate).not.toHaveBeenCalled()
      if (!result.success) return
      expect(result.data.pendingReconciliation).toEqual([])
    })

    it("unresolved TEMPLATE_FIELD-dependent condition — creates the document ACTIVE conservatively, marked pending reconciliation", async () => {
      packetTemplateDocumentFindMany.mockResolvedValue([
        mappingRow({
          documentTemplate: { id: DOC_TEMPLATE_ID, organizationId: ORG_ID, fields: [{ id: "dtf-1", fieldKey: "some_field", fieldType: "checkbox", isRequired: false, conditionGroups: [] }] },
          conditionGroups: [conditionGroupRow({ conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "some_field", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "CHECKED", comparisonValue: null, sortOrder: 0 }] })],
        }),
      ])
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(result.success).toBe(true)
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ applicabilityStatus: "ACTIVE" }) })
      if (!result.success) return
      expect(result.data.pendingReconciliation).toEqual([MAPPING_ID])
    })
  })

  describe("initial requiredness policy", () => {
    it("no DOCUMENT_REQUIREDNESS condition — preserves the static mapping.required value", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateWithDocs([
        { id: MAPPING_ID, documentTemplateId: DOC_TEMPLATE_ID, required: false, sortOrder: 0, documentTemplate: { id: DOC_TEMPLATE_ID, organizationId: ORG_ID } },
      ]))
      packetTemplateDocumentFindMany.mockResolvedValue([mappingRow({ required: false })])
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ isRequired: false }) })
    })

    it("pseudo-field requiredness condition applies the evaluated result", async () => {
      packetTemplateDocumentFindMany.mockResolvedValue([
        mappingRow({
          required: false,
          conditionGroups: [conditionGroupRow({ purpose: "DOCUMENT_REQUIREDNESS", conditions: [{ id: "c1", sourceType: "PACKET_TYPE", sourceFieldKey: null, sourcePacketTemplateDocumentId: null, operator: "EQUALS", comparisonValue: "initial_intake", sortOrder: 0 }] })],
        }),
      ])
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ isRequired: true }) })
    })

    it("unresolved field-dependent requiredness preserves the conservative static value", async () => {
      packetTemplateDocumentFindMany.mockResolvedValue([
        mappingRow({
          required: true,
          documentTemplate: { id: DOC_TEMPLATE_ID, organizationId: ORG_ID, fields: [{ id: "dtf-1", fieldKey: "some_field", fieldType: "checkbox", isRequired: false, conditionGroups: [] }] },
          conditionGroups: [conditionGroupRow({ purpose: "DOCUMENT_REQUIREDNESS", conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "some_field", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "CHECKED", comparisonValue: null, sortOrder: 0 }] })],
        }),
      ])
      const { createPacket } = await import("@/lib/actions/templates")
      const result = await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetDocumentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ isRequired: true }) })
      if (!result.success) return
      expect(result.data.pendingReconciliation).toEqual([MAPPING_ID])
    })
  })

  describe("program and context", () => {
    it("sets Packet.programId from PacketTemplate.programId", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateRow({ programId: "prog-1", program: { id: "prog-1", code: "cadi", organizationId: ORG_ID } }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetCreate.mock.calls[0][0].data.programId).toBe("prog-1")
    })

    it("packetType is the packet template's canonical value", async () => {
      packetTemplateFindUnique.mockResolvedValue(packetTemplateRow({ packetType: "45_day" }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetCreate.mock.calls[0][0].data.packetType).toBe("45_day")
    })

    it("freezes clientIsMinor as of packet creation time — clearly a minor", async () => {
      const fiveYearsAgo = new Date(Date.now() - 5 * 365 * 24 * 60 * 60 * 1000)
      clientFindUnique.mockResolvedValue(clientRow({ dateOfBirth: fiveYearsAgo }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetConditionSnapshotCreate.mock.calls[0][0].data.clientIsMinor).toBe(true)
    })

    it("freezes clientIsMinor as of packet creation time — clearly an adult", async () => {
      const fortyYearsAgo = new Date(Date.now() - 40 * 365 * 24 * 60 * 60 * 1000)
      clientFindUnique.mockResolvedValue(clientRow({ dateOfBirth: fortyYearsAgo }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetConditionSnapshotCreate.mock.calls[0][0].data.clientIsMinor).toBe(false)
    })

    it("a null date of birth is handled safely — never a minor", async () => {
      clientFindUnique.mockResolvedValue(clientRow({ dateOfBirth: null }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })
      expect(packetConditionSnapshotCreate.mock.calls[0][0].data.clientIsMinor).toBe(false)
    })
  })

  describe("audit", () => {
    it("records snapshot and initial-applicability audit events with safe metadata only", async () => {
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      const snapshotAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "PACKET_CONDITION_SNAPSHOT_CREATED")
      expect(snapshotAudit).toBeDefined()
      expect(snapshotAudit![0].metadata).toEqual({ packetId: PACKET_ID, packetTemplateId: PACKET_TEMPLATE_ID, snapshotId: "snap-1", runtimeVersion: 1, trigger: "packet_creation" })

      const applicabilityAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "PACKET_DOCUMENT_INITIAL_APPLICABILITY_SET")
      expect(applicabilityAudit).toBeDefined()
      expect(applicabilityAudit![0].metadata).toMatchObject({ packetId: PACKET_ID, packetTemplateId: PACKET_TEMPLATE_ID, packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", trigger: "packet_creation" })
      expect(Object.keys(applicabilityAudit![0].metadata)).not.toContain("comparisonValue")

      const createdAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "PACKET_CREATED")
      expect(createdAudit).toBeDefined()
    })

    it("no audit metadata anywhere contains DOB, client name, or field values", async () => {
      clientFindUnique.mockResolvedValue(clientRow({ dateOfBirth: new Date("2010-05-01"), firstName: "Jane", lastName: "Doe" }))
      const { createPacket } = await import("@/lib/actions/templates")
      await createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })

      for (const call of createAuditEventMock.mock.calls) {
        const serialized = JSON.stringify(call[0].metadata)
        expect(serialized).not.toContain("2010-05-01")
        expect(serialized).not.toContain("Jane")
        expect(serialized).not.toContain("Doe")
      }
    })
  })

  describe("transactionality", () => {
    it("rolls back (rejects, creates nothing) if snapshot creation fails", async () => {
      packetConditionSnapshotCreate.mockRejectedValue(new Error("snapshot write failed"))
      const { createPacket } = await import("@/lib/actions/templates")
      await expect(createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })).rejects.toThrow("snapshot write failed")
      expect(packetCreate).not.toHaveBeenCalled()
      expect(packetDocumentCreate).not.toHaveBeenCalled()
      expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_CREATED")).toBe(false)
    })

    it("rolls back if a PacketDocument create fails", async () => {
      packetDocumentCreate.mockRejectedValue(new Error("packet document write failed"))
      const { createPacket } = await import("@/lib/actions/templates")
      await expect(createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })).rejects.toThrow("packet document write failed")
      expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_CREATED")).toBe(false)
    })

    it("rolls back if PdfField seeding fails", async () => {
      documentTemplateFieldFindMany.mockImplementation(async () => [
        { id: "dtf-1", fieldKey: "client_name", name: "Client Name", fieldType: "text", pageNumber: 1, posX: 0, posY: 0, width: 100, height: 20, isRequired: true, sortOrder: 0 },
      ])
      pdfFieldCreateMany.mockRejectedValue(new Error("field seeding failed"))
      const { createPacket } = await import("@/lib/actions/templates")
      await expect(createPacket({ clientId: CLIENT_ID, packetTemplateId: PACKET_TEMPLATE_ID })).rejects.toThrow("field seeding failed")
      expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_CREATED")).toBe(false)
    })
  })
})
