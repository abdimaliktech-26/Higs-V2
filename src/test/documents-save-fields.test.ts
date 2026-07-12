// Stage 5 Step 4c.2b — transactional saveDocumentFields, field-ownership
// verification, and live document-applicability reconciliation on save.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

const packetDocumentFindUnique = vi.fn()
const pdfFieldFindMany = vi.fn()
const pdfFieldUpdate = vi.fn()
const pdfFieldCreate = vi.fn()
const pdfFieldCount = vi.fn()
const packetDocumentUpdate = vi.fn()
const packetDocumentCreate = vi.fn() // never expected to be called by reconciliation — presence proves it if it ever is
const txPacketFindUnique = vi.fn()

function makeTx() {
  return {
    pdfField: {
      findMany: (...a: unknown[]) => pdfFieldFindMany(...a),
      update: (...a: unknown[]) => pdfFieldUpdate(...a),
      create: (...a: unknown[]) => pdfFieldCreate(...a),
      count: (...a: unknown[]) => pdfFieldCount(...a),
    },
    packetDocument: {
      update: (...a: unknown[]) => packetDocumentUpdate(...a),
      create: (...a: unknown[]) => packetDocumentCreate(...a),
    },
    packet: { findUnique: (...a: unknown[]) => txPacketFindUnique(...a) },
  }
}
let currentTx = makeTx()
const transactionMock = vi.fn((cb: any) => cb(currentTx))

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a) },
    $transaction: (cb: any) => transactionMock(cb),
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/storage", () => ({ signUrl: () => "https://example.com/signed" }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const PACKET_ID = "pkt-1"
const DOC_ID = "doc-1"
const DOC_SIBLING_ID = "doc-2"
const PACKET_TEMPLATE_ID = "pt-1"
const MAPPING_ID = "mapping-1"
const MAPPING_SIBLING = "mapping-2"
const FIELD_ID = "field-trigger"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function legacyDoc(overrides: Record<string, unknown> = {}) {
  return { id: DOC_ID, packetId: PACKET_ID, packet: { id: PACKET_ID, organizationId: ORG_ID, conditionSnapshotId: null, conditionRuntimeVersion: null, ...overrides } }
}

function conditionAwareDoc(overrides: Record<string, unknown> = {}) {
  return { id: DOC_ID, packetId: PACKET_ID, packet: { id: PACKET_ID, organizationId: ORG_ID, conditionSnapshotId: "snap-1", conditionRuntimeVersion: 1, ...overrides } }
}

function definitionFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    packetTemplateId: PACKET_TEMPLATE_ID,
    mappings: [
      { id: MAPPING_ID, documentTemplateId: "dtA", required: true, sortOrder: 0, conditionGroups: [], fields: [{ id: "dtf-a1", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] }] },
      {
        id: MAPPING_SIBLING, documentTemplateId: "dtB", required: true, sortOrder: 1,
        conditionGroups: [{
          id: "grp-b", purpose: "DOCUMENT_INCLUSION" as const, logicOperator: "AND" as const,
          conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "CHECKED" as const, comparisonValue: null }],
          childGroups: [],
        }],
        fields: [],
      },
    ],
    ...overrides,
  }
}

function packetSnapshotRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKET_ID, organizationId: ORG_ID, packetType: "initial_intake",
    program: null,
    conditionSnapshotId: "snap-1", conditionRuntimeVersion: 1,
    conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: definitionFixture() },
    documents: [
      { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: null }] },
      { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
    ],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue({})
  getActiveRoleMock.mockReturnValue("CASE_MANAGER")
  pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
  pdfFieldUpdate.mockResolvedValue({})
  pdfFieldCreate.mockResolvedValue({})
  pdfFieldCount.mockResolvedValue(0)
  packetDocumentUpdate.mockResolvedValue({})
})

describe("saveDocumentFields — legacy packets (static, unchanged)", () => {
  it("saves fields normally with no reconciliation", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_ID }, data: { value: "true", posX: undefined, posY: undefined } })
    expect(packetDocumentUpdate).toHaveBeenCalledWith({ where: { id: DOC_ID }, data: { status: "completed" } })
  })

  it("never touches applicabilityStatus for a legacy packet", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(txPacketFindUnique).not.toHaveBeenCalled()
    expect(packetDocumentUpdate.mock.calls.every((c: any) => !("applicabilityStatus" in c[0].data))).toBe(true)
  })

  it("writes no reconciliation audit event for a legacy packet", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_DOCUMENT_APPLICABILITY_RECONCILED")).toBe(false)
    expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "DOCUMENT_SAVED")).toBe(true)
  })
})

describe("saveDocumentFields — ownership and authorization", () => {
  it("rejects a field id that does not belong to this document", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    pdfFieldFindMany.mockResolvedValue([]) // this document owns no such field
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: "field-from-elsewhere", name: "X", fieldType: "text", value: "hacked", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/do not belong to this document/i)
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
  })

  it("rejects a cross-tenant field id the same way (the ownership check is scoped by document, not by trusting the id)", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }]) // only the real field belongs here
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: "field-other-org", name: "X", fieldType: "text", value: "y", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/do not belong to this document/i)
  })

  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null)
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/unauthorized/i)
    expect(packetDocumentFindUnique).not.toHaveBeenCalled()
  })

  it("rejects a role without edit permission", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    getActiveRoleMock.mockReturnValue("DSP")
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [])
    expect(result.success).toBe(false)
    expect(pdfFieldFindMany).not.toHaveBeenCalled()
  })

  it("allows a new manual field with no id (scoped to this document by construction, no ownership risk)", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ name: "Manual Note", fieldType: "text", value: "hello", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    expect(pdfFieldCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ packetDocumentId: DOC_ID, source: "manual", value: "hello" }) })
  })
})

describe("saveDocumentFields — transactionality", () => {
  it("rolls back (returns failure) if a field write fails, leaving later steps untouched", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    pdfFieldUpdate.mockRejectedValue(new Error("db write failed"))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/db write failed/i)
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
    expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "DOCUMENT_SAVED")).toBe(false)
  })

  it("rolls back the whole save if reconciliation hits an integrity error", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({ conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { broken: true } } }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/malformed/i)
  })

  it("commits multiple field writes atomically in one call", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: "field-2" }])
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: "field-2", name: "Notes", fieldType: "text", value: "hello", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate).toHaveBeenCalledTimes(2)
  })

  it("rolls back if the audit write itself fails (defensive — createAuditEvent never actually throws in production, but the transaction boundary must still hold if it ever did)", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    createAuditEventMock.mockRejectedValueOnce(new Error("audit write failed"))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
  })
})

describe("saveDocumentFields — reconciliation on condition-aware packets", () => {
  it("flips a sibling document from CONDITIONALLY_INACTIVE to ACTIVE when the controlling field is set", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    expect(packetDocumentUpdate).toHaveBeenCalledWith({
      where: { id: DOC_SIBLING_ID },
      data: { applicabilityStatus: "ACTIVE", conditionallyInactiveAt: null, conditionallyInactiveReason: null },
    })
    const reconcileAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "PACKET_DOCUMENT_APPLICABILITY_RECONCILED")
    expect(reconcileAudit![0].metadata).toMatchObject({ packetId: PACKET_ID, packetDocumentId: DOC_SIBLING_ID, previousApplicabilityStatus: "CONDITIONALLY_INACTIVE", nextApplicabilityStatus: "ACTIVE", trigger: "field_save" })
  })

  it("flips a document from ACTIVE to CONDITIONALLY_INACTIVE when the controlling field is unchecked, setting timestamp and safe reason", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: null }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    const call = packetDocumentUpdate.mock.calls.find((c: any) => c[0].where.id === DOC_SIBLING_ID)
    expect(call![0].data.applicabilityStatus).toBe("CONDITIONALLY_INACTIVE")
    expect(call![0].data.conditionallyInactiveAt).toBeInstanceOf(Date)
    expect(call![0].data.conditionallyInactiveReason).toBe("condition_false_after_field_save")
  })

  it("ACTIVE -> ACTIVE is a no-op: no write, no audit", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(packetDocumentUpdate.mock.calls.some((c: any) => c[0].where.id === DOC_SIBLING_ID)).toBe(false)
    expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_DOCUMENT_APPLICABILITY_RECONCILED")).toBe(false)
  })

  it("CONDITIONALLY_INACTIVE -> CONDITIONALLY_INACTIVE is a no-op: no write, no audit", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: null }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false }])
    expect(packetDocumentUpdate.mock.calls.some((c: any) => c[0].where.id === DOC_SIBLING_ID)).toBe(false)
    expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_DOCUMENT_APPLICABILITY_RECONCILED")).toBe(false)
  })

  it("reactivation clears the inactivity timestamp/reason and never creates a second PacketDocument", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(packetDocumentCreate).not.toHaveBeenCalled()
    const call = packetDocumentUpdate.mock.calls.find((c: any) => c[0].where.id === DOC_SIBLING_ID)
    expect(call![0].data).toEqual({ applicabilityStatus: "ACTIVE", conditionallyInactiveAt: null, conditionallyInactiveReason: null })
  })

  it("every mapped document is re-evaluated, and an unrelated document with no condition remains untouched", async () => {
    const MAPPING_C = "mapping-c"
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      conditionSnapshot: {
        id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false,
        definition: definitionFixture({
          mappings: [
            ...definitionFixture().mappings,
            { id: MAPPING_C, documentTemplateId: "dtC", required: true, sortOrder: 2, conditionGroups: [], fields: [] },
          ],
        }),
      },
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
        { id: "doc-c", documentTemplateId: "dtC", packetTemplateDocumentId: MAPPING_C, applicabilityStatus: "ACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    // Sibling B transitions; unconditional C is never written to.
    expect(packetDocumentUpdate.mock.calls.some((c: any) => c[0].where.id === DOC_SIBLING_ID)).toBe(true)
    expect(packetDocumentUpdate.mock.calls.some((c: any) => c[0].where.id === "doc-c")).toBe(false)
  })

  it("one field save can transition more than one dependent document", async () => {
    const MAPPING_C = "mapping-c"
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      conditionSnapshot: {
        id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false,
        definition: definitionFixture({
          mappings: [
            ...definitionFixture().mappings,
            {
              id: MAPPING_C, documentTemplateId: "dtC", required: true, sortOrder: 2,
              conditionGroups: [{ id: "grp-c", purpose: "DOCUMENT_INCLUSION", logicOperator: "AND", conditions: [{ sourceType: "TEMPLATE_FIELD", sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "CHECKED", comparisonValue: null }], childGroups: [] }],
              fields: [],
            },
          ],
        }),
      },
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
        { id: "doc-c", documentTemplateId: "dtC", packetTemplateDocumentId: MAPPING_C, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(packetDocumentUpdate.mock.calls.filter((c: any) => c[0].data.applicabilityStatus === "ACTIVE").map((c: any) => c[0].where.id).sort()).toEqual([DOC_SIBLING_ID, "doc-c"])
  })

  it("evaluates a nested (AND/OR) condition tree correctly", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      conditionSnapshot: {
        id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false,
        definition: definitionFixture({
          mappings: [
            definitionFixture().mappings[0],
            {
              id: MAPPING_SIBLING, documentTemplateId: "dtB", required: true, sortOrder: 1,
              conditionGroups: [{
                id: "grp-b", purpose: "DOCUMENT_INCLUSION", logicOperator: "OR",
                conditions: [{ sourceType: "PACKET_TYPE", sourceFieldKey: null, sourcePacketTemplateDocumentId: null, operator: "EQUALS", comparisonValue: "45_day" }],
                childGroups: [{ id: "grp-b-nested", purpose: "DOCUMENT_INCLUSION", logicOperator: "AND", conditions: [{ sourceType: "TEMPLATE_FIELD", sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "CHECKED", comparisonValue: null }], childGroups: [] }],
              }],
              fields: [],
            },
          ],
        }),
      },
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    // packetType is "initial_intake" (false for the top-level condition), but the nested OR branch (trigger CHECKED) is true -> overall true.
    expect(packetDocumentUpdate).toHaveBeenCalledWith({ where: { id: DOC_SIBLING_ID }, data: { applicabilityStatus: "ACTIVE", conditionallyInactiveAt: null, conditionallyInactiveReason: null } })
  })
})

describe("saveDocumentFields — reconciliation integrity errors abort safely", () => {
  it("aborts when an applicable mapping has no materialized PacketDocument", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        // DOC_SIBLING_ID intentionally absent even though its condition will evaluate true.
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/no materialized PacketDocument/i)
  })

  it("aborts when the snapshot definition is malformed", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { not: "valid" } },
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/malformed/i)
  })

  it("aborts when a PdfField's templateFieldKey is not present in the snapshot", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "ghost_key", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not present in the snapshot/i)
  })

  it("aborts when the runtime version marker does not match the snapshot's own version", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc({ conditionRuntimeVersion: 2 }))
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({ conditionRuntimeVersion: 2 }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/does not match its snapshot/i)
  })
})

describe("saveDocumentFields — trusted snapshot, no live template dependency", () => {
  it("evaluates purely from the immutable snapshot — no live template/condition tables are ever queried by reconciliation", async () => {
    // No templateConditionGroup/documentTemplateField mocks are wired into
    // this test file's @/lib/db mock at all — if reconciliation touched
    // either, this would throw (cannot read property of undefined).
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
  })
})

describe("saveDocumentFields — audit metadata safety", () => {
  it("reconciliation audit metadata contains no PHI, field values, or comparison values", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: "true" }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    const reconcileAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "PACKET_DOCUMENT_APPLICABILITY_RECONCILED")
    expect(Object.keys(reconcileAudit![0].metadata).sort()).toEqual(["action", "nextApplicabilityStatus", "packetDocumentId", "packetId", "packetTemplateDocumentId", "previousApplicabilityStatus", "trigger"])
    expect(JSON.stringify(reconcileAudit![0].metadata)).not.toMatch(/comparisonValue|dateOfBirth|firstName|lastName/i)
  })
})
