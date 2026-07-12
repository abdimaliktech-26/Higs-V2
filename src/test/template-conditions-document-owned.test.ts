// Stage 5 Step 4b — document-owned condition CRUD, cross-document
// references, dependency cycles, and packet-template validation.
// Field-owned (same-document) behavior is covered by template-conditions.test.ts
// and is unaffected by anything in this file.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

const packetTemplateFindUnique = vi.fn()
const packetTemplateDocumentFindUnique = vi.fn()
const packetTemplateDocumentFindMany = vi.fn()
const documentTemplateFieldFindUnique = vi.fn()
const documentTemplateFieldFindFirst = vi.fn()
const documentTemplateFieldFindMany = vi.fn()
const templateConditionGroupFindUnique = vi.fn()
const templateConditionGroupFindFirst = vi.fn()
const templateConditionGroupFindMany = vi.fn()
const templateConditionGroupCreate = vi.fn()
const templateConditionGroupUpdate = vi.fn()
const templateConditionGroupDelete = vi.fn()
const templateConditionFindUnique = vi.fn()
const templateConditionFindMany = vi.fn()
const templateConditionCreate = vi.fn()
const templateConditionUpdate = vi.fn()
const templateConditionDelete = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetTemplate: { findUnique: (...a: unknown[]) => packetTemplateFindUnique(...a) },
    packetTemplateDocument: {
      findUnique: (...a: unknown[]) => packetTemplateDocumentFindUnique(...a),
      findMany: (...a: unknown[]) => packetTemplateDocumentFindMany(...a),
    },
    documentTemplateField: {
      findUnique: (...a: unknown[]) => documentTemplateFieldFindUnique(...a),
      findFirst: (...a: unknown[]) => documentTemplateFieldFindFirst(...a),
      findMany: (...a: unknown[]) => documentTemplateFieldFindMany(...a),
    },
    templateConditionGroup: {
      findUnique: (...a: unknown[]) => templateConditionGroupFindUnique(...a),
      findFirst: (...a: unknown[]) => templateConditionGroupFindFirst(...a),
      findMany: (...a: unknown[]) => templateConditionGroupFindMany(...a),
      create: (...a: unknown[]) => templateConditionGroupCreate(...a),
      update: (...a: unknown[]) => templateConditionGroupUpdate(...a),
      delete: (...a: unknown[]) => templateConditionGroupDelete(...a),
    },
    templateCondition: {
      findUnique: (...a: unknown[]) => templateConditionFindUnique(...a),
      findMany: (...a: unknown[]) => templateConditionFindMany(...a),
      create: (...a: unknown[]) => templateConditionCreate(...a),
      update: (...a: unknown[]) => templateConditionUpdate(...a),
      delete: (...a: unknown[]) => templateConditionDelete(...a),
    },
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
const OTHER_ORG_ID = "org-2"
const STAFF_ID = "staff-1"
const PT_ID = "pt-1"
const OTHER_PT_ID = "pt-2"
const DT_A = "dtA"
const DT_B = "dtB"
const MAPPING_A = "ptd-a"
const MAPPING_B = "ptd-b"
const FIELD_A_ID = "field-a"
const FIELD_B_ID = "field-b"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function mappingRow(id: string, documentTemplateId: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    packetTemplateId: PT_ID,
    documentTemplateId,
    packetTemplate: { id: PT_ID, organizationId: ORG_ID },
    documentTemplate: { id: documentTemplateId, organizationId: ORG_ID, status: "draft" },
    ...overrides,
  }
}

function mockMappings(rows: Record<string, ReturnType<typeof mappingRow> | null>) {
  packetTemplateDocumentFindUnique.mockImplementation(async ({ where }: any) => rows[where.id] ?? null)
}

function fieldRow(id: string, documentTemplateId: string, fieldKey: string, fieldType = "checkbox") {
  return { id, organizationId: ORG_ID, documentTemplateId, fieldKey, fieldType }
}

function mockFields(rows: ReturnType<typeof fieldRow>[]) {
  documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
    const key = where.documentTemplateId_fieldKey
    return rows.find((r) => r.documentTemplateId === key.documentTemplateId && r.fieldKey === key.fieldKey) ?? null
  })
}

function rootGroupRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "grp-1", organizationId: ORG_ID, purpose: "DOCUMENT_INCLUSION", logicOperator: "AND",
    parentGroupId: null, documentTemplateFieldId: null, packetTemplateDocumentId: MAPPING_A, validationRuleId: null,
    ...overrides,
  }
}

function mockGroupChain(groups: Record<string, any>) {
  templateConditionGroupFindUnique.mockImplementation(async ({ where }: any) => groups[where.id] ?? null)
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  getActiveRoleMock.mockReturnValue("ORG_ADMIN")
  requireOrgAccessMock.mockResolvedValue({})
  packetTemplateFindUnique.mockResolvedValue({ id: PT_ID, organizationId: ORG_ID })
  documentTemplateFieldFindFirst.mockResolvedValue(null)
  documentTemplateFieldFindMany.mockResolvedValue([])
  packetTemplateDocumentFindMany.mockResolvedValue([])
  templateConditionGroupFindMany.mockResolvedValue([])
  templateConditionGroupFindFirst.mockResolvedValue(null)
})

describe("createRootConditionGroupForDocument", () => {
  it("creates a DOCUMENT_INCLUSION root group owned by the mapping, audited with safe metadata", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    templateConditionGroupCreate.mockImplementation(async ({ data }: any) => ({ id: "grp-1", ...data }))

    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose: "DOCUMENT_INCLUSION", logicOperator: "AND" })

    expect(result.success).toBe(true)
    expect(templateConditionGroupCreate).toHaveBeenCalledWith({
      data: { organizationId: ORG_ID, purpose: "DOCUMENT_INCLUSION", logicOperator: "AND", packetTemplateDocumentId: MAPPING_A },
    })
    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.metadata).toEqual({ packetTemplateId: PT_ID, packetTemplateDocumentId: MAPPING_A, conditionGroupId: "grp-1", purpose: "DOCUMENT_INCLUSION", action: "group_created" })
    // No PHI, no comparison values, no document titles.
    expect(Object.keys(auditCall.metadata)).not.toContain("comparisonValue")
  })

  it("creates a DOCUMENT_REQUIREDNESS root group", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    templateConditionGroupCreate.mockImplementation(async ({ data }: any) => ({ id: "grp-1", ...data }))
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose: "DOCUMENT_REQUIREDNESS", logicOperator: "OR" })
    expect(result.success).toBe(true)
  })

  it("rejects an incompatible owner/purpose combination (FIELD_VISIBILITY on a document-owned group)", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose: "FIELD_VISIBILITY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not valid for a document-owned/i)
    expect(templateConditionGroupCreate).not.toHaveBeenCalled()
  })

  it("rejects a role not permitted to manage templates", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose: "DOCUMENT_INCLUSION" })
    expect(result.success).toBe(false)
    expect(packetTemplateDocumentFindUnique).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant mapping access", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A, { packetTemplate: { id: PT_ID, organizationId: OTHER_ORG_ID } }) })
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    await expect(createRootConditionGroupForDocument(MAPPING_A, { purpose: "DOCUMENT_INCLUSION" })).rejects.toThrow("Access denied")
  })

  it("rejects when the underlying document template is retired", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A, { documentTemplate: { id: DT_A, organizationId: ORG_ID, status: "retired" } }) })
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose: "DOCUMENT_INCLUSION" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/retired/i)
  })

  it("rejects a nonexistent mapping", async () => {
    mockMappings({})
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument("does-not-exist", { purpose: "DOCUMENT_INCLUSION" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it.each(["DOCUMENT_INCLUSION", "DOCUMENT_REQUIREDNESS"])("rejects a duplicate %s root for the same mapping", async (purpose) => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    templateConditionGroupFindFirst.mockResolvedValue({ id: "existing-root" })
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose, logicOperator: "AND" })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toContain("already exists")
    expect(templateConditionGroupCreate).not.toHaveBeenCalled()
  })

  it("turns a concurrent-create race (P2002 past the pre-check) into the same clean duplicate-root error", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    templateConditionGroupFindFirst.mockResolvedValue(null)
    templateConditionGroupCreate.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed on the fields: (`packet_template_document_id`,`purpose`)", { code: "P2002", clientVersion: "7.8.0" })
    )
    const { createRootConditionGroupForDocument } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroupForDocument(MAPPING_A, { purpose: "DOCUMENT_INCLUSION", logicOperator: "AND" })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error).toBe("A DOCUMENT_INCLUSION root group already exists for this document mapping")
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })
})

describe("createNestedConditionGroup — document-owned parent", () => {
  it("creates a nested group under a document-owned root, inheriting purpose, with no owner of its own", async () => {
    mockGroupChain({ "grp-1": rootGroupRow() })
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    templateConditionGroupCreate.mockImplementation(async ({ data }: any) => ({ id: "grp-2", ...data }))

    const { createNestedConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createNestedConditionGroup("grp-1", { logicOperator: "OR" })

    expect(result.success).toBe(true)
    expect(templateConditionGroupCreate).toHaveBeenCalledWith({
      data: { organizationId: ORG_ID, purpose: "DOCUMENT_INCLUSION", logicOperator: "OR", parentGroupId: "grp-1" },
    })
  })

  it("rejects nesting beyond depth 2 under a document-owned root", async () => {
    mockGroupChain({ "grp-2": { ...rootGroupRow({ id: "grp-2" }), parentGroupId: "grp-1", packetTemplateDocumentId: null } })
    const { createNestedConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createNestedConditionGroup("grp-2", { logicOperator: "AND" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/maximum nesting depth/i)
  })
})

describe("createCondition — cross-document references (Step 4b)", () => {
  beforeEach(() => {
    mockGroupChain({ "grp-1": rootGroupRow() })
    mockFields([fieldRow(FIELD_A_ID, DT_A, "is_minor_flag", "checkbox"), fieldRow(FIELD_B_ID, DT_B, "guardian_name", "text")])
    templateConditionCreate.mockImplementation(async ({ data }: any) => ({ id: "cond-1", ...data }))
  })

  it("a reference to the owner document's own field succeeds", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "is_minor_flag", sourcePacketTemplateDocumentId: MAPPING_A, operator: "CHECKED" })
    expect(result.success).toBe(true)
    expect(templateConditionCreate.mock.calls[0][0].data.sourcePacketTemplateDocumentId).toBe(MAPPING_A)
  })

  it("a reference to a sibling document's field in the same packet template succeeds", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A), [MAPPING_B]: mappingRow(MAPPING_B, DT_B) })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "guardian_name", sourcePacketTemplateDocumentId: MAPPING_B, operator: "NOT_EMPTY" })
    expect(result.success).toBe(true)
    expect(templateConditionCreate.mock.calls[0][0].data.sourcePacketTemplateDocumentId).toBe(MAPPING_B)
  })

  it("a mapping from a different PacketTemplate is rejected", async () => {
    mockMappings({
      [MAPPING_A]: mappingRow(MAPPING_A, DT_A),
      [MAPPING_B]: mappingRow(MAPPING_B, DT_B, { packetTemplateId: OTHER_PT_ID, packetTemplate: { id: OTHER_PT_ID, organizationId: ORG_ID } }),
    })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "guardian_name", sourcePacketTemplateDocumentId: MAPPING_B, operator: "NOT_EMPTY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/different packet template/i)
  })

  it("a mapping from a different organization is rejected", async () => {
    mockMappings({
      [MAPPING_A]: mappingRow(MAPPING_A, DT_A),
      [MAPPING_B]: mappingRow(MAPPING_B, DT_B, { packetTemplate: { id: PT_ID, organizationId: OTHER_ORG_ID } }),
    })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "guardian_name", sourcePacketTemplateDocumentId: MAPPING_B, operator: "NOT_EMPTY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it("a nonexistent mapping is rejected", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "x", sourcePacketTemplateDocumentId: "does-not-exist", operator: "NOT_EMPTY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it("a nonexistent fieldKey on the referenced mapping's document is rejected", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "ghost_field", sourcePacketTemplateDocumentId: MAPPING_A, operator: "NOT_EMPTY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found on the referenced document/i)
  })

  it("a fieldKey that exists but on a different document is rejected with a clear message", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A), [MAPPING_B]: mappingRow(MAPPING_B, DT_B) })
    // guardian_name lives on DT_B, not DT_A — referencing MAPPING_A with that key should fail clearly.
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "guardian_name", sourcePacketTemplateDocumentId: MAPPING_A, operator: "NOT_EMPTY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found on the referenced document/i)
  })

  it("a TEMPLATE_FIELD condition on a document-owned group missing sourcePacketTemplateDocumentId is rejected", async () => {
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "is_minor_flag", operator: "CHECKED" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/sourcePacketTemplateDocumentId is required/i)
  })

  it("a pseudo-field condition must not carry sourcePacketTemplateDocumentId", async () => {
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-1", { sourceType: "PACKET_PROGRAM_CODE", sourcePacketTemplateDocumentId: MAPPING_A, operator: "EQUALS", comparisonValue: "cadi" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/must not include/i)
  })

  it("a field-owned group's condition must not carry sourcePacketTemplateDocumentId", async () => {
    mockGroupChain({
      "grp-field": { id: "grp-field", organizationId: ORG_ID, purpose: "FIELD_VISIBILITY", logicOperator: "AND", parentGroupId: null, documentTemplateFieldId: FIELD_A_ID, packetTemplateDocumentId: null, validationRuleId: null },
    })
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.id === FIELD_A_ID) return { id: FIELD_A_ID, fieldKey: "is_minor_flag", documentTemplate: { id: DT_A, organizationId: ORG_ID, status: "draft" } }
      const key = where.documentTemplateId_fieldKey
      if (key) return fieldRow(FIELD_A_ID, DT_A, "is_minor_flag", "checkbox").fieldKey === key.fieldKey && key.documentTemplateId === DT_A ? fieldRow(FIELD_A_ID, DT_A, "is_minor_flag", "checkbox") : null
      return null
    })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition("grp-field", { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "is_minor_flag", sourcePacketTemplateDocumentId: MAPPING_A, operator: "CHECKED" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/field-owned conditions must not reference/i)
  })
})

describe("getConditionsForPacketTemplateDocument", () => {
  it("returns the condition tree owned by the mapping", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A) })
    templateConditionGroupFindMany.mockResolvedValue([])
    const { getConditionsForPacketTemplateDocument } = await import("@/lib/actions/template-conditions")
    await expect(getConditionsForPacketTemplateDocument(MAPPING_A)).resolves.toEqual([])
    expect(requireOrgAccessMock).toHaveBeenCalledWith(ORG_ID)
  })

  it("rejects cross-tenant reads", async () => {
    mockMappings({ [MAPPING_A]: mappingRow(MAPPING_A, DT_A, { packetTemplate: { id: PT_ID, organizationId: OTHER_ORG_ID } }) })
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { getConditionsForPacketTemplateDocument } = await import("@/lib/actions/template-conditions")
    await expect(getConditionsForPacketTemplateDocument(MAPPING_A)).rejects.toThrow("Access denied")
  })
})

describe("validatePacketTemplateConditions", () => {
  function mockPacketMappings(mappings: { id: string; documentTemplateId: string }[]) {
    packetTemplateDocumentFindMany.mockResolvedValue(mappings)
  }
  function mockAllFields(fields: { documentTemplateId: string; fieldKey: string; fieldType: string }[]) {
    documentTemplateFieldFindMany.mockResolvedValue(fields)
  }
  function inclusionGroup(mappingId: string, id: string, conditions: any[], childGroups: any[] = []): { id: string; packetTemplateDocumentId: string; documentTemplateFieldId: null; validationRuleId: null; parentGroupId: string | null; purpose: string; conditions: any[]; childGroups: any[] } {
    return { id, packetTemplateDocumentId: mappingId, documentTemplateFieldId: null, validationRuleId: null, parentGroupId: null, purpose: "DOCUMENT_INCLUSION", conditions, childGroups }
  }
  function fieldCond(id: string, sourcePacketTemplateDocumentId: string, sourceFieldKey: string, operator = "CHECKED", comparisonValue: unknown = null) {
    return { id, sourceType: "TEMPLATE_FIELD", sourceFieldKey, sourcePacketTemplateDocumentId, operator, comparisonValue }
  }

  it("a valid acyclic condition tree passes", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B }])
    mockAllFields([{ documentTemplateId: DT_B, fieldKey: "guardian_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_B, "guardian_name", "NOT_EMPTY")])])

    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("a packet template with no mapped documents is trivially valid", async () => {
    mockPacketMappings([])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result).toEqual({ valid: true, errors: [] })
  })

  it("throws for a nonexistent packet template", async () => {
    packetTemplateFindUnique.mockResolvedValue(null)
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    await expect(validatePacketTemplateConditions("does-not-exist")).rejects.toThrow("not found")
  })

  it("rejects cross-tenant validation", async () => {
    packetTemplateFindUnique.mockResolvedValue({ id: PT_ID, organizationId: OTHER_ORG_ID })
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    await expect(validatePacketTemplateConditions(PT_ID)).rejects.toThrow("Access denied")
  })

  it("detects an invalid owner/purpose combination", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    templateConditionGroupFindMany.mockResolvedValue([{ ...inclusionGroup(MAPPING_A, "grp-1", []), purpose: "FIELD_VISIBILITY", conditions: [fieldCond("c1", MAPPING_A, "x")] }])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.type === "invalid_owner_purpose")).toBe(true)
  })

  it("detects a missing owner", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    templateConditionGroupFindMany.mockResolvedValue([{ ...inclusionGroup(MAPPING_A, "grp-1", []), packetTemplateDocumentId: null, conditions: [] }])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "ownerless_root_group")).toBe(true)
  })

  it("detects multiple owners", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    templateConditionGroupFindMany.mockResolvedValue([{ ...inclusionGroup(MAPPING_A, "grp-1", []), documentTemplateFieldId: "some-field", conditions: [] }])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "multiple_owners")).toBe(true)
  })

  it("detects a nonexistent source mapping", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", "ptd-ghost", "x")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "nonexistent_source_mapping")).toBe(true)
  })

  it("detects a source mapping outside the owner's packet template (not returned by the packetTemplateDocument.findMany scoped query)", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }]) // MAPPING_B deliberately absent — belongs to a different packet template
    mockAllFields([])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_B, "guardian_name")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "nonexistent_source_mapping")).toBe(true)
  })

  it("detects a nonexistent field key", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    documentTemplateFieldFindFirst.mockResolvedValue(null)
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_A, "ghost_field")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "nonexistent_field_key")).toBe(true)
  })

  it("detects a field that exists but on a different document", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B }])
    mockAllFields([{ documentTemplateId: DT_B, fieldKey: "guardian_name", fieldType: "text" }])
    documentTemplateFieldFindFirst.mockResolvedValue({ id: FIELD_B_ID, documentTemplateId: DT_B, fieldKey: "guardian_name" })
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_A, "guardian_name")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "field_wrong_document")).toBe(true)
  })

  it("detects an invalid operator for the field's type", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([{ documentTemplateId: DT_A, fieldKey: "guardian_signature_date", fieldType: "date" }])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_A, "guardian_signature_date", "CHECKED")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "invalid_operator_for_type")).toBe(true)
  })

  it("detects a malformed comparison value", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([{ documentTemplateId: DT_A, fieldKey: "program", fieldType: "select" }])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_A, "program", "IN", "not-an-array")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "malformed_comparison_value")).toBe(true)
  })

  it("detects excessive nesting", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    const grandchild = { id: "grp-3", packetTemplateDocumentId: null, documentTemplateFieldId: null, validationRuleId: null, parentGroupId: "grp-2", purpose: "DOCUMENT_INCLUSION", conditions: [], childGroups: [] }
    const child = { id: "grp-2", packetTemplateDocumentId: null, documentTemplateFieldId: null, validationRuleId: null, parentGroupId: "grp-1", purpose: "DOCUMENT_INCLUSION", conditions: [], childGroups: [grandchild] }
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [], [child])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "excessive_nesting")).toBe(true)
  })

  it("detects a circular parent group", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    const group = inclusionGroup(MAPPING_A, "grp-1", [])
    group.parentGroupId = "grp-1"
    templateConditionGroupFindMany.mockResolvedValue([group])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "circular_group")).toBe(true)
  })

  it("detects an empty group", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "empty_group")).toBe(true)
  })

  it("detects an orphan nested group whose parentGroupId does not match its actual root", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([])
    const child = { id: "grp-2", packetTemplateDocumentId: null, documentTemplateFieldId: null, validationRuleId: null, parentGroupId: "grp-OTHER", purpose: "DOCUMENT_INCLUSION", conditions: [fieldCond("c1", MAPPING_A, "x")], childGroups: [] }
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [], [child])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "orphan_nested_group")).toBe(true)
  })

  it("rejects a self-cycle: a mapping's inclusion depends on one of its own fields", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }])
    mockAllFields([{ documentTemplateId: DT_A, fieldKey: "is_minor_flag", fieldType: "checkbox" }])
    templateConditionGroupFindMany.mockResolvedValue([inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_A, "is_minor_flag")])])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.valid).toBe(false)
    const cycleError = result.errors.find((e) => e.type === "inclusion_cycle")
    expect(cycleError).toBeDefined()
    expect(cycleError!.packetTemplateDocumentIds).toEqual([MAPPING_A, MAPPING_A])
  })

  it("rejects a two-document cycle: A -> B -> A", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B }])
    mockAllFields([
      { documentTemplateId: DT_A, fieldKey: "field_a", fieldType: "checkbox" },
      { documentTemplateId: DT_B, fieldKey: "field_b", fieldType: "checkbox" },
    ])
    templateConditionGroupFindMany.mockResolvedValue([
      inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_B, "field_b")]),
      inclusionGroup(MAPPING_B, "grp-2", [fieldCond("c2", MAPPING_A, "field_a")]),
    ])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "inclusion_cycle")).toBe(true)
  })

  it("rejects a longer cycle: A -> B -> C -> A", async () => {
    const MAPPING_C = "ptd-c"
    const DT_C = "dtC"
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B }, { id: MAPPING_C, documentTemplateId: DT_C }])
    mockAllFields([
      { documentTemplateId: DT_A, fieldKey: "field_a", fieldType: "checkbox" },
      { documentTemplateId: DT_B, fieldKey: "field_b", fieldType: "checkbox" },
      { documentTemplateId: DT_C, fieldKey: "field_c", fieldType: "checkbox" },
    ])
    templateConditionGroupFindMany.mockResolvedValue([
      inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_B, "field_b")]),
      inclusionGroup(MAPPING_B, "grp-2", [fieldCond("c2", MAPPING_C, "field_c")]),
      inclusionGroup(MAPPING_C, "grp-3", [fieldCond("c3", MAPPING_A, "field_a")]),
    ])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "inclusion_cycle")).toBe(true)
  })

  it("includes nested-group conditions in cycle detection", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B }])
    mockAllFields([
      { documentTemplateId: DT_A, fieldKey: "field_a", fieldType: "checkbox" },
      { documentTemplateId: DT_B, fieldKey: "field_b", fieldType: "checkbox" },
    ])
    const nestedChild = { id: "grp-1b", packetTemplateDocumentId: null, documentTemplateFieldId: null, validationRuleId: null, parentGroupId: "grp-1", purpose: "DOCUMENT_INCLUSION", conditions: [fieldCond("c-nested", MAPPING_B, "field_b")], childGroups: [] }
    templateConditionGroupFindMany.mockResolvedValue([
      inclusionGroup(MAPPING_A, "grp-1", [], [nestedChild]),
      inclusionGroup(MAPPING_B, "grp-2", [fieldCond("c2", MAPPING_A, "field_a")]),
    ])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "inclusion_cycle")).toBe(true)
  })

  it("an acyclic multi-document graph (diamond shape) passes", async () => {
    const MAPPING_C = "ptd-c"
    const MAPPING_D = "ptd-d"
    const DT_C = "dtC"
    const DT_D = "dtD"
    mockPacketMappings([
      { id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B },
      { id: MAPPING_C, documentTemplateId: DT_C }, { id: MAPPING_D, documentTemplateId: DT_D },
    ])
    mockAllFields([
      { documentTemplateId: DT_B, fieldKey: "field_b", fieldType: "checkbox" },
      { documentTemplateId: DT_C, fieldKey: "field_c", fieldType: "checkbox" },
      { documentTemplateId: DT_D, fieldKey: "field_d", fieldType: "checkbox" },
    ])
    templateConditionGroupFindMany.mockResolvedValue([
      inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_B, "field_b")]),
      inclusionGroup(MAPPING_B, "grp-2", [fieldCond("c2", MAPPING_D, "field_d")]),
      inclusionGroup(MAPPING_C, "grp-3", [fieldCond("c3", MAPPING_D, "field_d")]),
    ])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.valid).toBe(true)
  })

  it("DOCUMENT_REQUIREDNESS groups do not participate in inclusion-cycle detection", async () => {
    mockPacketMappings([{ id: MAPPING_A, documentTemplateId: DT_A }, { id: MAPPING_B, documentTemplateId: DT_B }])
    mockAllFields([
      { documentTemplateId: DT_A, fieldKey: "field_a", fieldType: "checkbox" },
      { documentTemplateId: DT_B, fieldKey: "field_b", fieldType: "checkbox" },
    ])
    // Both groups reference each other, but as DOCUMENT_REQUIREDNESS, not DOCUMENT_INCLUSION.
    templateConditionGroupFindMany.mockResolvedValue([
      { ...inclusionGroup(MAPPING_A, "grp-1", [fieldCond("c1", MAPPING_B, "field_b")]), purpose: "DOCUMENT_REQUIREDNESS" },
      { ...inclusionGroup(MAPPING_B, "grp-2", [fieldCond("c2", MAPPING_A, "field_a")]), purpose: "DOCUMENT_REQUIREDNESS" },
    ])
    const { validatePacketTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validatePacketTemplateConditions(PT_ID)
    expect(result.errors.some((e) => e.type === "inclusion_cycle")).toBe(false)
  })
})
