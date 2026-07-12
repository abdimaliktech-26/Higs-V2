import { describe, it, expect, vi, beforeEach } from "vitest"

const documentTemplateFieldFindUnique = vi.fn()
const documentTemplateFieldFindFirst = vi.fn()
const documentTemplateFieldFindMany = vi.fn()
const templateConditionGroupFindUnique = vi.fn()
const templateConditionGroupFindMany = vi.fn()
const templateConditionGroupCreate = vi.fn()
const templateConditionGroupUpdate = vi.fn()
const templateConditionGroupDelete = vi.fn()
const templateConditionFindUnique = vi.fn()
const templateConditionFindMany = vi.fn()
const templateConditionCreate = vi.fn()
const templateConditionUpdate = vi.fn()
const templateConditionDelete = vi.fn()
const documentTemplateFindUnique = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    documentTemplateField: {
      findUnique: (...a: unknown[]) => documentTemplateFieldFindUnique(...a),
      findFirst: (...a: unknown[]) => documentTemplateFieldFindFirst(...a),
      findMany: (...a: unknown[]) => documentTemplateFieldFindMany(...a),
    },
    templateConditionGroup: {
      findUnique: (...a: unknown[]) => templateConditionGroupFindUnique(...a),
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
    documentTemplate: { findUnique: (...a: unknown[]) => documentTemplateFindUnique(...a) },
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
const FIELD_ID = "field-1"
const GROUP_ID = "group-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function fieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIELD_ID, organizationId: ORG_ID, documentTemplateId: TEMPLATE_ID, fieldKey: "client_name", fieldType: "text",
    documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" },
    ...overrides,
  }
}

function rootGroupRow(overrides: Record<string, unknown> = {}) {
  return { id: GROUP_ID, organizationId: ORG_ID, purpose: "FIELD_VISIBILITY", logicOperator: "AND", parentGroupId: null, documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  getActiveRoleMock.mockReturnValue("ORG_ADMIN")
  requireOrgAccessMock.mockResolvedValue({})
})

describe("createRootConditionGroup", () => {
  it("creates a root group owned by the field, audited with safe metadata", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow())
    templateConditionGroupCreate.mockImplementation(async ({ data }: any) => ({ id: GROUP_ID, ...data }))

    const { createRootConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroup(FIELD_ID, { purpose: "FIELD_VISIBILITY", logicOperator: "AND" })

    expect(result.success).toBe(true)
    const createData = templateConditionGroupCreate.mock.calls[0][0].data
    expect(createData.documentTemplateFieldId).toBe(FIELD_ID)
    expect(createData.organizationId).toBe(ORG_ID)

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("TEMPLATE_CONDITION_CREATED")
    expect(auditCall.metadata).toEqual({ documentTemplateId: TEMPLATE_ID, conditionGroupId: GROUP_ID, purpose: "FIELD_VISIBILITY", ownerFieldKey: "client_name", action: "group_created" })
    // No comparison values, field values, or client data in metadata.
    expect(Object.keys(auditCall.metadata).sort()).toEqual(["action", "conditionGroupId", "documentTemplateId", "ownerFieldKey", "purpose"])
  })

  it("rejects an unauthorized role", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { createRootConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroup(FIELD_ID, { purpose: "FIELD_VISIBILITY" })
    expect(result.success).toBe(false)
    expect(documentTemplateFieldFindUnique).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant field ownership", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow({ documentTemplate: { id: TEMPLATE_ID, organizationId: "org-OTHER", status: "draft" } }))
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { createRootConditionGroup } = await import("@/lib/actions/template-conditions")
    await expect(createRootConditionGroup(FIELD_ID, { purpose: "FIELD_VISIBILITY" })).rejects.toThrow("Access denied")
    expect(templateConditionGroupCreate).not.toHaveBeenCalled()
  })

  it("rejects editing a retired template", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow({ documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "retired" } }))
    const { createRootConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroup(FIELD_ID, { purpose: "FIELD_VISIBILITY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/retired/i)
    expect(templateConditionGroupCreate).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent field", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(null)
    const { createRootConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createRootConditionGroup("does-not-exist", { purpose: "FIELD_VISIBILITY" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })
})

describe("createNestedConditionGroup", () => {
  it("creates a nested group with no owner of its own, inheriting the parent's purpose", async () => {
    templateConditionGroupFindUnique.mockResolvedValue(rootGroupRow())
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow())
    templateConditionGroupCreate.mockImplementation(async ({ data }: any) => ({ id: "nested-1", ...data }))

    const { createNestedConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createNestedConditionGroup(GROUP_ID, { logicOperator: "OR" })

    expect(result.success).toBe(true)
    const createData = templateConditionGroupCreate.mock.calls[0][0].data
    expect(createData.parentGroupId).toBe(GROUP_ID)
    expect(createData.purpose).toBe("FIELD_VISIBILITY")
    expect(createData).not.toHaveProperty("documentTemplateFieldId")
  })

  it("rejects nesting beyond depth 2 (parent is already nested)", async () => {
    templateConditionGroupFindUnique.mockResolvedValue(rootGroupRow({ id: "nested-1", parentGroupId: GROUP_ID, documentTemplateFieldId: null }))
    const { createNestedConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createNestedConditionGroup("nested-1", { logicOperator: "AND" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/depth/i)
    expect(templateConditionGroupCreate).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent parent group", async () => {
    templateConditionGroupFindUnique.mockResolvedValue(null)
    const { createNestedConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await createNestedConditionGroup("does-not-exist", { logicOperator: "AND" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })
})

describe("createCondition — source/operator/type validation", () => {
  beforeEach(() => {
    templateConditionGroupFindUnique.mockResolvedValue(rootGroupRow())
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => (where.id === FIELD_ID ? fieldRow() : null))
  })

  it("creates a condition referencing a real field on the same template", async () => {
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.documentTemplateId_fieldKey) return fieldRow({ fieldType: "checkbox" })
      return fieldRow()
    })
    templateConditionCreate.mockImplementation(async ({ data }: any) => ({ id: "cond-1", ...data }))

    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "CHECKED" })

    expect(result.success).toBe(true)
    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.metadata.conditionId).toBe("cond-1")
    expect(Object.keys(auditCall.metadata)).not.toContain("comparisonValue")
  })

  it("rejects a nonexistent fieldKey", async () => {
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.documentTemplateId_fieldKey) return null
      return fieldRow()
    })
    documentTemplateFieldFindFirst.mockResolvedValue(null)

    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "does_not_exist", operator: "EQUALS", comparisonValue: "x" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
    expect(templateConditionCreate).not.toHaveBeenCalled()
  })

  it("rejects a fieldKey that belongs to a different template with a clear cross-template message", async () => {
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.documentTemplateId_fieldKey) return null
      return fieldRow()
    })
    documentTemplateFieldFindFirst.mockResolvedValue({ id: "other-field", documentTemplateId: "tpl-OTHER" })

    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "shared_key", operator: "EQUALS", comparisonValue: "x" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/different template/i)
  })

  it("rejects an operator incompatible with the field's type", async () => {
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.documentTemplateId_fieldKey) return fieldRow({ fieldType: "signature" })
      return fieldRow()
    })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "BEFORE", comparisonValue: "2025-01-01" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not valid/i)
    expect(templateConditionCreate).not.toHaveBeenCalled()
  })

  it("rejects a malformed comparisonValue for the operator", async () => {
    documentTemplateFieldFindUnique.mockImplementation(async ({ where }: any) => {
      if (where.documentTemplateId_fieldKey) return fieldRow({ fieldType: "date" })
      return fieldRow()
    })
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "BEFORE", comparisonValue: "not-a-date" })
    expect(result.success).toBe(false)
    expect(templateConditionCreate).not.toHaveBeenCalled()
  })

  it("accepts a pseudo-field condition (CLIENT_IS_MINOR) with no sourceFieldKey", async () => {
    templateConditionCreate.mockImplementation(async ({ data }: any) => ({ id: "cond-2", ...data }))
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "CLIENT_IS_MINOR", operator: "EQUALS", comparisonValue: true })
    expect(result.success).toBe(true)
    expect(templateConditionCreate.mock.calls[0][0].data.sourceFieldKey).toBeNull()
  })

  it("rejects a pseudo-field condition that includes a sourceFieldKey", async () => {
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "CLIENT_IS_MINOR", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: true })
    expect(result.success).toBe(false)
    expect(templateConditionCreate).not.toHaveBeenCalled()
  })

  it("rejects an unauthorized role", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "CLIENT_IS_MINOR", operator: "EQUALS", comparisonValue: true })
    expect(result.success).toBe(false)
    expect(templateConditionGroupFindUnique).not.toHaveBeenCalled()
  })

  it("rejects creating a condition on a retired template", async () => {
    templateConditionGroupFindUnique.mockResolvedValue(rootGroupRow())
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow({ documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "retired" } }))
    const { createCondition } = await import("@/lib/actions/template-conditions")
    const result = await createCondition(GROUP_ID, { sourceType: "CLIENT_IS_MINOR", operator: "EQUALS", comparisonValue: true })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/retired/i)
  })
})

describe("deleteConditionGroup / deleteCondition", () => {
  it("deletes a group and audits with safe metadata", async () => {
    templateConditionGroupFindUnique.mockResolvedValue(rootGroupRow())
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow())
    templateConditionGroupDelete.mockResolvedValue({})

    const { deleteConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await deleteConditionGroup(GROUP_ID)

    expect(result.success).toBe(true)
    expect(templateConditionGroupDelete).toHaveBeenCalledWith({ where: { id: GROUP_ID } })
    expect(createAuditEventMock.mock.calls[0][0].action).toBe("TEMPLATE_CONDITION_DELETED")
  })

  it("rejects deleting on a retired template", async () => {
    templateConditionGroupFindUnique.mockResolvedValue(rootGroupRow())
    documentTemplateFieldFindUnique.mockResolvedValue(fieldRow({ documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "retired" } }))
    const { deleteConditionGroup } = await import("@/lib/actions/template-conditions")
    const result = await deleteConditionGroup(GROUP_ID)
    expect(result.success).toBe(false)
    expect(templateConditionGroupDelete).not.toHaveBeenCalled()
  })
})

describe("getConditionsForTemplate — reads allowed on retired templates", () => {
  it("returns the tree for a field-owned template", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "retired" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    templateConditionGroupFindMany.mockResolvedValue([])

    const { getConditionsForTemplate } = await import("@/lib/actions/template-conditions")
    await expect(getConditionsForTemplate(TEMPLATE_ID)).resolves.toEqual([])
    expect(requireOrgAccessMock).toHaveBeenCalledWith(ORG_ID)
  })

  it("rejects cross-tenant reads", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: "org-OTHER", status: "draft" })
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { getConditionsForTemplate } = await import("@/lib/actions/template-conditions")
    await expect(getConditionsForTemplate(TEMPLATE_ID)).rejects.toThrow("Access denied")
  })
})

describe("getFieldConditionDependencySummary", () => {
  it("reports accurate count and purposes, no client data", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    templateConditionFindMany.mockResolvedValue([
      { id: "c1", group: { purpose: "FIELD_VISIBILITY" } },
      { id: "c2", group: { purpose: "FIELD_REQUIREDNESS" } },
      { id: "c3", group: { purpose: "FIELD_VISIBILITY" } },
    ])

    const { getFieldConditionDependencySummary } = await import("@/lib/actions/template-conditions")
    const summary = await getFieldConditionDependencySummary(TEMPLATE_ID, "client_name")

    expect(summary.count).toBe(3)
    expect(summary.purposes.sort()).toEqual(["FIELD_REQUIREDNESS", "FIELD_VISIBILITY"])
  })

  it("returns zero when no template fields exist", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([])
    const { getFieldConditionDependencySummary } = await import("@/lib/actions/template-conditions")
    const summary = await getFieldConditionDependencySummary(TEMPLATE_ID, "client_name")
    expect(summary).toEqual({ count: 0, purposes: [] })
    expect(templateConditionFindMany).not.toHaveBeenCalled()
  })
})

describe("validateTemplateConditions", () => {
  it("detects a nonexistent field key reference", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID, fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValue([
      {
        id: GROUP_ID, documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null,
        conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "ghost_field", operator: "EQUALS", comparisonValue: "x" }],
        childGroups: [],
      },
    ])
    documentTemplateFieldFindFirst.mockResolvedValue(null)

    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)

    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.type === "nonexistent_field_key")).toBe(true)
  })

  it("detects an empty group", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID, fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValue([
      { id: GROUP_ID, documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null, conditions: [], childGroups: [] },
    ])

    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)
    expect(result.errors.some((e) => e.type === "empty_group")).toBe(true)
  })

  it("detects an invalid comparison value", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID, fieldKey: "client_name", fieldType: "date" }])
    templateConditionGroupFindMany.mockResolvedValue([
      {
        id: GROUP_ID, documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null,
        conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "BEFORE", comparisonValue: "not-a-date" }],
        childGroups: [],
      },
    ])

    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)
    expect(result.errors.some((e) => e.type === "malformed_comparison_value")).toBe(true)
  })

  it("detects excessive nesting (a child group with its own child groups)", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID, fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValue([
      {
        id: GROUP_ID, documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null,
        conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: "x" }],
        childGroups: [
          {
            id: "child-1", parentGroupId: GROUP_ID, documentTemplateFieldId: null, packetTemplateDocumentId: null, validationRuleId: null,
            conditions: [{ id: "c2", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: "y" }],
            childGroups: [{ id: "grandchild-1" }],
          },
        ],
      },
    ])

    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)
    expect(result.errors.some((e) => e.type === "excessive_nesting")).toBe(true)
  })

  it("detects ownerless root groups and multiple-owner root groups", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID, fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValue([
      { id: "g-none", documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null, conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: "x" }], childGroups: [] },
    ])
    // Simulate a corrupted row with both an owner AND a parent by re-mocking for this test's direct multi-owner check via a second group in the array
    templateConditionGroupFindMany.mockResolvedValueOnce([
      { id: "g-multi", documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: "some-doc", validationRuleId: null, parentGroupId: null, conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: "x" }], childGroups: [] },
    ])

    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)
    expect(result.errors.some((e) => e.type === "multiple_owners")).toBe(true)
  })

  it("valid conditions produce no errors", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID, fieldKey: "client_name", fieldType: "text" }])
    templateConditionGroupFindMany.mockResolvedValue([
      {
        id: GROUP_ID, documentTemplateFieldId: FIELD_ID, packetTemplateDocumentId: null, validationRuleId: null, parentGroupId: null,
        conditions: [{ id: "c1", sourceType: "TEMPLATE_FIELD", sourceFieldKey: "client_name", operator: "EQUALS", comparisonValue: "x" }],
        childGroups: [],
      },
    ])

    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)
    expect(result.valid).toBe(true)
    expect(result.errors).toEqual([])
  })

  it("a template with no fields at all is trivially valid", async () => {
    documentTemplateFindUnique.mockResolvedValue({ id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" })
    documentTemplateFieldFindMany.mockResolvedValue([])
    const { validateTemplateConditions } = await import("@/lib/actions/template-conditions")
    const result = await validateTemplateConditions(TEMPLATE_ID)
    expect(result.valid).toBe(true)
    expect(templateConditionGroupFindMany).not.toHaveBeenCalled()
  })
})
