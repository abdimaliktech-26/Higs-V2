import { describe, it, expect, vi, beforeEach } from "vitest"

const documentTemplateFindUnique = vi.fn()
const documentTemplateFieldFindUnique = vi.fn()
const documentTemplateFieldFindMany = vi.fn()
const documentTemplateFieldCreate = vi.fn()
const documentTemplateFieldUpdate = vi.fn()
const documentTemplateFieldDelete = vi.fn()
const templateConditionFindMany = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    documentTemplate: { findUnique: (...a: unknown[]) => documentTemplateFindUnique(...a) },
    documentTemplateField: {
      findUnique: (...a: unknown[]) => documentTemplateFieldFindUnique(...a),
      findMany: (...a: unknown[]) => documentTemplateFieldFindMany(...a),
      create: (...a: unknown[]) => documentTemplateFieldCreate(...a),
      update: (...a: unknown[]) => documentTemplateFieldUpdate(...a),
      delete: (...a: unknown[]) => documentTemplateFieldDelete(...a),
    },
    // Backs getFieldConditionDependencySummary (src/lib/actions/template-conditions.ts),
    // called for real (not mocked away) by update/delete's dependency-protection check.
    templateCondition: { findMany: (...a: unknown[]) => templateConditionFindMany(...a) },
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

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function draftTemplate(overrides: Record<string, unknown> = {}) {
  return { id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft", ...overrides }
}

function validFieldInput(overrides: Record<string, unknown> = {}) {
  return { fieldKey: "client_name", name: "Client Name", fieldType: "text", pageNumber: 1, posX: 40, posY: 30, width: 180, height: 32, isRequired: true, ...overrides }
}

beforeEach(() => {
  vi.clearAllMocks()
  // Safe defaults for getFieldConditionDependencySummary (real, unmocked
  // dependency-protection check now run by update/delete) — "0 dependencies"
  // unless a specific test overrides these to exercise the guard itself.
  documentTemplateFieldFindMany.mockResolvedValue([])
  templateConditionFindMany.mockResolvedValue([])
})

describe("getDocumentTemplateFields", () => {
  it("returns fields ordered by sortOrder, scoped to the organization", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    requireOrgAccessMock.mockResolvedValue({})
    documentTemplateFieldFindMany.mockResolvedValue([])

    const { getDocumentTemplateFields } = await import("@/lib/actions/document-template-fields")
    await getDocumentTemplateFields(TEMPLATE_ID)

    expect(requireOrgAccessMock).toHaveBeenCalledWith(ORG_ID)
    expect(documentTemplateFieldFindMany).toHaveBeenCalledWith({ where: { documentTemplateId: TEMPLATE_ID }, orderBy: { sortOrder: "asc" } })
  })

  it("allows reading fields on a retired template (read-only, not blocked)", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate({ status: "retired" }))
    requireOrgAccessMock.mockResolvedValue({})
    documentTemplateFieldFindMany.mockResolvedValue([])

    const { getDocumentTemplateFields } = await import("@/lib/actions/document-template-fields")
    await expect(getDocumentTemplateFields(TEMPLATE_ID)).resolves.toEqual([])
  })

  it("rejects when the template does not exist", async () => {
    documentTemplateFindUnique.mockResolvedValue(null)
    const { getDocumentTemplateFields } = await import("@/lib/actions/document-template-fields")
    await expect(getDocumentTemplateFields("does-not-exist")).rejects.toThrow(/not found/i)
  })

  it("rejects cross-tenant access", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate({ organizationId: "org-OTHER" }))
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { getDocumentTemplateFields } = await import("@/lib/actions/document-template-fields")
    await expect(getDocumentTemplateFields(TEMPLATE_ID)).rejects.toThrow("Access denied")
  })
})

describe("createDocumentTemplateField", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    requireOrgAccessMock.mockResolvedValue({})
  })

  it("creates a field and records a TEMPLATE_FIELD_CREATED audit event with safe metadata only", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    documentTemplateFieldFindUnique.mockResolvedValue(null)
    documentTemplateFieldCreate.mockImplementation(async ({ data }: any) => ({ id: FIELD_ID, ...data }))

    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput())

    expect(result.success).toBe(true)
    const createData = documentTemplateFieldCreate.mock.calls[0][0].data
    expect(createData.fieldKey).toBe("client_name")
    expect(createData.organizationId).toBe(ORG_ID)

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("TEMPLATE_FIELD_CREATED")
    expect(auditCall.metadata).toEqual({ documentTemplateId: TEMPLATE_ID, templateFieldId: FIELD_ID, fieldKey: "client_name", action: "created" })
  })

  it("rejects a duplicate fieldKey within the same template", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    documentTemplateFieldFindUnique.mockResolvedValue({ id: "existing-field" })

    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput())

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already exists/i)
    expect(documentTemplateFieldCreate).not.toHaveBeenCalled()
  })

  it("rejects an unsupported field type", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput({ fieldType: "barcode" }))
    expect(result.success).toBe(false)
    expect(documentTemplateFieldCreate).not.toHaveBeenCalled()
  })

  it.each([
    ["a non-positive page number", { pageNumber: 0 }],
    ["a negative coordinate", { posX: -5 }],
    ["a coordinate far out of bounds", { posY: 99999 }],
    ["a non-positive width", { width: 0 }],
    ["a non-positive height", { height: -10 }],
    ["an empty name", { name: "" }],
    ["a malformed field key (uppercase)", { fieldKey: "ClientName" }],
    ["a malformed field key (starts with digit)", { fieldKey: "1name" }],
  ])("rejects %s", async (_label, overrides) => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput(overrides))
    expect(result.success).toBe(false)
    expect(documentTemplateFieldCreate).not.toHaveBeenCalled()
  })

  it("rejects a role not permitted to manage templates", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput())
    expect(result.success).toBe(false)
    expect(documentTemplateFindUnique).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant field creation", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate({ organizationId: "org-OTHER" }))
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    await expect(createDocumentTemplateField(TEMPLATE_ID, validFieldInput())).rejects.toThrow("Access denied")
  })

  it("rejects creating a field on a retired template", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate({ status: "retired" }))
    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput())
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/retired/i)
    expect(documentTemplateFieldCreate).not.toHaveBeenCalled()
  })

  it("allows creating a field on an active template", async () => {
    documentTemplateFindUnique.mockResolvedValue(draftTemplate({ status: "active" }))
    documentTemplateFieldFindUnique.mockResolvedValue(null)
    documentTemplateFieldCreate.mockImplementation(async ({ data }: any) => ({ id: FIELD_ID, ...data }))
    const { createDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await createDocumentTemplateField(TEMPLATE_ID, validFieldInput())
    expect(result.success).toBe(true)
  })
})

function existingField(overrides: Record<string, unknown> = {}) {
  return {
    id: FIELD_ID, fieldKey: "client_name", documentTemplateId: TEMPLATE_ID,
    documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "draft" },
    ...overrides,
  }
}

describe("updateDocumentTemplateField", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    requireOrgAccessMock.mockResolvedValue({})
  })

  it("updates a field and records a TEMPLATE_FIELD_UPDATED audit event", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField())
    documentTemplateFieldUpdate.mockResolvedValue({ fieldKey: "client_name" })

    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { name: "Client Full Name" })

    expect(result.success).toBe(true)
    expect(documentTemplateFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_ID }, data: { name: "Client Full Name" } })

    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("TEMPLATE_FIELD_UPDATED")
    expect(auditCall.metadata).toEqual({ documentTemplateId: TEMPLATE_ID, templateFieldId: FIELD_ID, fieldKey: "client_name", action: "updated" })
  })

  it("rejects renaming fieldKey to one that already exists on the same template", async () => {
    documentTemplateFieldFindUnique
      .mockResolvedValueOnce(existingField())
      .mockResolvedValueOnce({ id: "other-field" })

    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { fieldKey: "guardian_signature" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already exists/i)
    expect(documentTemplateFieldUpdate).not.toHaveBeenCalled()
  })

  it("rejects invalid coordinates on update", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField())
    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { posX: -1 })
    expect(result.success).toBe(false)
    expect(documentTemplateFieldUpdate).not.toHaveBeenCalled()
  })

  it("blocks renaming a fieldKey that a condition depends on", async () => {
    documentTemplateFieldFindUnique.mockResolvedValueOnce(existingField()).mockResolvedValueOnce(null)
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    templateConditionFindMany.mockImplementation(async (args: any) =>
      "sourcePacketTemplateDocumentId" in args.where ? [{ id: "c1", group: { purpose: "FIELD_VISIBILITY" } }] : []
    )

    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { fieldKey: "new_key" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/1 condition/i)
    expect(documentTemplateFieldUpdate).not.toHaveBeenCalled()
  })

  it("still allows a display-name-only change even when the field has dependent conditions", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField())
    documentTemplateFieldUpdate.mockResolvedValue({ fieldKey: "client_name" })
    // Dependencies exist, but fieldKey isn't changing — the guard should never even run.
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    templateConditionFindMany.mockResolvedValue([{ id: "c1", group: { purpose: "FIELD_VISIBILITY" } }])

    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { name: "New Display Name" })

    expect(result.success).toBe(true)
    expect(documentTemplateFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_ID }, data: { name: "New Display Name" } })
  })

  it("rejects a nonexistent field", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(null)
    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField("does-not-exist", { name: "X" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it("rejects a role not permitted to manage templates", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { name: "X" })
    expect(result.success).toBe(false)
    expect(documentTemplateFieldFindUnique).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant field update", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField({ documentTemplate: { id: TEMPLATE_ID, organizationId: "org-OTHER", status: "draft" } }))
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    await expect(updateDocumentTemplateField(FIELD_ID, { name: "X" })).rejects.toThrow("Access denied")
  })

  it("rejects updating a field on a retired template", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField({ documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "retired" } }))
    const { updateDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await updateDocumentTemplateField(FIELD_ID, { name: "X" })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/retired/i)
    expect(documentTemplateFieldUpdate).not.toHaveBeenCalled()
  })
})

describe("deleteDocumentTemplateField", () => {
  beforeEach(() => {
    authMock.mockResolvedValue(staffSession())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    requireOrgAccessMock.mockResolvedValue({})
  })

  it("deletes a field and records a TEMPLATE_FIELD_DELETED audit event", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField())
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    documentTemplateFieldDelete.mockResolvedValue({})

    const { deleteDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await deleteDocumentTemplateField(FIELD_ID)

    expect(result.success).toBe(true)
    expect(documentTemplateFieldDelete).toHaveBeenCalledWith({ where: { id: FIELD_ID } })
    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("TEMPLATE_FIELD_DELETED")
    expect(auditCall.metadata).toEqual({ documentTemplateId: TEMPLATE_ID, templateFieldId: FIELD_ID, fieldKey: "client_name", action: "deleted" })
  })

  it("blocks deleting a field that a condition depends on, reporting an accurate dependency count", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField())
    documentTemplateFindUnique.mockResolvedValue(draftTemplate())
    documentTemplateFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    templateConditionFindMany.mockImplementation(async (args: any) =>
      "sourcePacketTemplateDocumentId" in args.where
        ? [
            { id: "c1", group: { purpose: "FIELD_VISIBILITY" } },
            { id: "c2", group: { purpose: "FIELD_REQUIREDNESS" } },
          ]
        : []
    )

    const { deleteDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await deleteDocumentTemplateField(FIELD_ID)

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/2 condition/i)
    expect(documentTemplateFieldDelete).not.toHaveBeenCalled()
  })

  it("rejects a role not permitted to manage templates", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { deleteDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await deleteDocumentTemplateField(FIELD_ID)
    expect(result.success).toBe(false)
    expect(documentTemplateFieldFindUnique).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant field deletion", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField({ documentTemplate: { id: TEMPLATE_ID, organizationId: "org-OTHER", status: "draft" } }))
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { deleteDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    await expect(deleteDocumentTemplateField(FIELD_ID)).rejects.toThrow("Access denied")
  })

  it("rejects deleting a field on a retired template", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(existingField({ documentTemplate: { id: TEMPLATE_ID, organizationId: ORG_ID, status: "retired" } }))
    const { deleteDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await deleteDocumentTemplateField(FIELD_ID)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/retired/i)
    expect(documentTemplateFieldDelete).not.toHaveBeenCalled()
  })

  it("rejects deleting a nonexistent field", async () => {
    documentTemplateFieldFindUnique.mockResolvedValue(null)
    const { deleteDocumentTemplateField } = await import("@/lib/actions/document-template-fields")
    const result = await deleteDocumentTemplateField("does-not-exist")
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })
})
