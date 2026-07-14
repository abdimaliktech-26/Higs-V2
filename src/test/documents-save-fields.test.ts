// Stage 5 Step 4c.2b — transactional saveDocumentFields, field-ownership
// verification, and live document-applicability reconciliation on save.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const requireDocumentAccessMock = vi.fn()

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
vi.mock("@/lib/live-authorization", () => ({ requireDocumentAccess: (...a: unknown[]) => requireDocumentAccessMock(...a) }))
vi.mock("@/lib/storage", () => ({ signStaffFileUrl: () => "https://example.com/signed" }))
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
const FIELD_DEPENDENT = "field-dependent"
const FIELD_REQD = "field-reqd"
const FIELD_SIG = "field-sig"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

// `packetOverrides` merges into the nested `packet` (preserves every
// existing single-arg call site's meaning exactly); `docOverrides` merges
// into the outer PacketDocument row itself — added for Step 4c.3b's
// pre-transaction read-only checks (applicabilityStatus) which read the
// OUTER doc, not the packet-nested one.
function legacyDoc(packetOverrides: Record<string, unknown> = {}, docOverrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, packetId: PACKET_ID, applicabilityStatus: "ACTIVE",
    packet: { id: PACKET_ID, organizationId: ORG_ID, status: "draft", conditionSnapshotId: null, conditionRuntimeVersion: null, ...packetOverrides },
    ...docOverrides,
  }
}

function conditionAwareDoc(packetOverrides: Record<string, unknown> = {}, docOverrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, packetId: PACKET_ID, applicabilityStatus: "ACTIVE",
    packet: { id: PACKET_ID, organizationId: ORG_ID, status: "draft", conditionSnapshotId: "snap-1", conditionRuntimeVersion: 1, ...packetOverrides },
    ...docOverrides,
  }
}

function definitionFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    packetTemplateId: PACKET_TEMPLATE_ID,
    mappings: [
      {
        id: MAPPING_ID, documentTemplateId: "dtA", required: true, sortOrder: 0, conditionGroups: [],
        fields: [
          { id: "dtf-a1", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] },
          {
            id: "dtf-a2", fieldKey: "dependent", fieldType: "text", isRequired: false,
            conditionGroups: [{
              id: "grp-vis", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
              conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
              childGroups: [],
            }],
          },
          {
            id: "dtf-a3", fieldKey: "reqd_field", fieldType: "text", isRequired: false,
            conditionGroups: [{
              id: "grp-req", purpose: "FIELD_REQUIREDNESS" as const, logicOperator: "AND" as const,
              conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
              childGroups: [],
            }],
          },
          // No condition group at all — statically required, always visible.
          // Signature fields receive no special exception (decision #6):
          // this proves it by using the exact same generic evaluation path.
          { id: "dtf-a4", fieldKey: "sig_field", fieldType: "signature", isRequired: true, conditionGroups: [] },
        ],
      },
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

// Builds DOC_ID's own document row (for packetSnapshotRow's `documents`
// override) with the full trigger/dependent/reqd_field/sig_field field set
// used by the Step 4c.3b prospective-evaluation and status-recalculation
// tests. Any field explicitly passed as `undefined` is omitted entirely
// (used to simulate "not created yet" for the manual-field test).
function docWithFields(values: { trigger?: string | null; dependent?: string | null; reqd?: string | null; sig?: string | null }, extra: Record<string, unknown> = {}) {
  const fields = [
    { id: FIELD_ID, templateFieldKey: "trigger", value: values.trigger ?? null, isRequired: false },
    { id: FIELD_DEPENDENT, templateFieldKey: "dependent", value: values.dependent ?? null, isRequired: false },
    { id: FIELD_REQD, templateFieldKey: "reqd_field", value: values.reqd ?? null, isRequired: false },
    { id: FIELD_SIG, templateFieldKey: "sig_field", value: values.sig ?? null, isRequired: true },
  ]
  return { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields, ...extra }
}

beforeEach(() => {
  vi.clearAllMocks()
  currentTx = makeTx()
  transactionMock.mockImplementation((cb: any) => cb(currentTx))
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue({})
  getActiveRoleMock.mockReturnValue("CASE_MANAGER")
  requireDocumentAccessMock.mockResolvedValue({ userId: STAFF_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
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
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/access denied/i)
  })

  it("rejects a role without edit permission", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
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
    // Step 4c.3b: a broken snapshot is now caught during prospective
    // evaluation, before any write — and returns the same safe generic
    // configuration-error message used everywhere else, not the raw
    // internal reason.
    expect(result.error).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
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
    // Step 4c.3b: safe generic message, not the raw internal reason.
    expect(result.error).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
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
    expect(result.error).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("aborts when the runtime version marker does not match the snapshot's own version", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc({ conditionRuntimeVersion: 2 }))
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({ conditionRuntimeVersion: 2 }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
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

// ── Step 4c.3b — transactional save enforcement and condition-aware status
// recalculation ──────────────────────────────────────────────────────────
//
// All fixtures below share one definition: MAPPING_ID has trigger (no
// condition), dependent (FIELD_VISIBILITY: trigger CHECKED), reqd_field
// (FIELD_REQUIREDNESS: trigger CHECKED), and sig_field (fieldType
// "signature", statically required, no condition group at all — proving
// signature fields get no special exception). MAPPING_SIBLING's
// DOCUMENT_INCLUSION still depends on trigger unless a test overrides it.

describe("saveDocumentFields — 4c.3b: visible/hidden field writes", () => {
  it("updates a field whose visibility condition is already satisfied", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "old", reqd: "old", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "new value", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: "old", pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_DEPENDENT }, data: { value: "new value", posX: undefined, posY: undefined } })
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([])
  })

  it("ignores a submitted write to a field hidden in the persisted state, without failing the save", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: "stale value", reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted change while hidden", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    // The hidden field's row is never touched — no update call for it at all.
    expect(pdfFieldUpdate.mock.calls.some((c: any) => c[0].where.id === FIELD_DEPENDENT)).toBe(false)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
  })
})

describe("saveDocumentFields — 4c.3b: prospective-state evaluation", () => {
  it("a controller write in the same batch makes a dependent field visible, using the prospective (not stale) value", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: null, reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "new answer", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_ID }, data: { value: "true", posX: undefined, posY: undefined } })
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_DEPENDENT }, data: { value: "new answer", posX: undefined, posY: undefined } })
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([])
  })

  it("a controller write that hides a dependent field still commits the controller, and ignores only the dependent's write", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "existing answer", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted edit", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    // Step 4c.3b clear-value fix: a submitted `undefined` is normalized and
    // actually persisted as `null` — Prisma would otherwise silently omit
    // the column from the UPDATE and leave the field's previous value in
    // the database untouched.
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_ID }, data: { value: null, posX: undefined, posY: undefined } })
    expect(pdfFieldUpdate.mock.calls.some((c: any) => c[0].where.id === FIELD_DEPENDENT)).toBe(false)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
  })
})

describe("saveDocumentFields — 4c.3b: condition-aware status recalculation", () => {
  it("a visible, conditionally-required empty field keeps the document in_progress", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "x", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe("in_progress")
  })

  it("a visible, conditionally-required field with a value completes the document", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "x", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: "answer", pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe("completed")
  })

  it("a visible but conditionally-optional empty field never blocks completion (zero effectively-required fields => completed)", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: null, reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    // reqd_field is visible (no visibility condition) but its requiredness
    // condition (trigger CHECKED) is false, so it never counts as pending
    // even though it's empty; dependent is hidden and excluded entirely.
    if (result.success) expect(result.data.status).toBe("completed")
  })

  it("a hidden, statically-required field never blocks completion", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [{
        id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE",
        fields: [
          { id: FIELD_ID, templateFieldKey: "trigger", value: null, isRequired: false },
          { id: FIELD_DEPENDENT, templateFieldKey: "dependent", value: null, isRequired: true }, // statically required, but hidden
          { id: FIELD_REQD, templateFieldKey: "reqd_field", value: null, isRequired: false },
          { id: FIELD_SIG, templateFieldKey: "sig_field", value: "signed", isRequired: true },
        ],
      }, { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: undefined, pageNumber: 1, isRequired: true },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe("completed")
  })

  it("a signature field follows the identical effective-requiredness rule as any other field — empty blocks completion", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: null, reqd: null, sig: null }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: undefined, pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe("in_progress")
  })

  it("never overwrites persisted static isRequired on an existing field, regardless of what is submitted", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    // reqd_field is persisted with static isRequired:false — submit a lying
    // isRequired:true for it and confirm the update call never includes it.
    await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "x", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: "answer", pageNumber: 1, isRequired: true },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    for (const call of pdfFieldUpdate.mock.calls) {
      expect(call[0].data).not.toHaveProperty("isRequired")
      expect(Object.keys(call[0].data).sort()).toEqual(["posX", "posY", "value"])
    }
  })
})

describe("saveDocumentFields — 4c.3b: read-only enforcement", () => {
  it("rejects a save on a CONDITIONALLY_INACTIVE document before the transaction opens", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc({}, { applicabilityStatus: "CONDITIONALLY_INACTIVE" }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document is currently not applicable based on packet conditions and cannot be edited.")
    expect(transactionMock).not.toHaveBeenCalled()
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })

  it("rejects a save on an approved packet (legacy)", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc({ status: "approved" }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document is approved and locked for editing.")
    expect(transactionMock).not.toHaveBeenCalled()
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })

  it("rejects a save on an archived packet", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc({ status: "archived" }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document is approved and locked for editing.")
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("also rejects an approval-locked, condition-aware document's save the same way (no separate lock flag beyond packet status)", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc({ status: "approved" }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document is approved and locked for editing.")
    expect(transactionMock).not.toHaveBeenCalled()
  })
})

describe("saveDocumentFields — 4c.3b: integrity-error rollback safety net", () => {
  it("also aborts and rolls back if the post-write (final) integrity check finds a problem, even though the prospective pass was clean", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    txPacketFindUnique
      .mockResolvedValueOnce(packetSnapshotRow({ documents: [docWithFields({ trigger: "true", dependent: "x", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }] }))
      .mockResolvedValueOnce(packetSnapshotRow({ conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { broken: true } } }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    // The status write, audit, and reconciliation never happen once the
    // transaction throws — this is what actually rolls back in real
    // Postgres; a mock can only prove the downstream steps were never
    // reached, which is the same guarantee the transaction depends on.
    expect(packetDocumentUpdate).not.toHaveBeenCalled()
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })
})

describe("saveDocumentFields — 4c.3b: reconciliation reads accepted, persisted values only", () => {
  it("an ignored hidden-field write can never influence a sibling document's applicability", async () => {
    const dangerDefinition = definitionFixture({
      mappings: [
        definitionFixture().mappings[0],
        {
          id: MAPPING_SIBLING, documentTemplateId: "dtB", required: true, sortOrder: 1,
          conditionGroups: [{
            id: "grp-b-danger", purpose: "DOCUMENT_INCLUSION" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "dependent", sourcePacketTemplateDocumentId: MAPPING_ID, operator: "EQUALS" as const, comparisonValue: "danger" }],
            childGroups: [],
          }],
          fields: [],
        },
      ],
    })
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: dangerDefinition },
      documents: [docWithFields({ trigger: null, dependent: null, reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false }, // stays unchecked — dependent stays hidden
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "danger", pageNumber: 1, isRequired: false }, // attempted while hidden
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
    expect(pdfFieldUpdate.mock.calls.some((c: any) => c[0].where.id === FIELD_DEPENDENT)).toBe(false)
    // If the ignored "danger" value had leaked into reconciliation, the
    // sibling would flip to ACTIVE. It must not.
    expect(packetDocumentUpdate.mock.calls.some((c: any) => c[0].where.id === DOC_SIBLING_ID)).toBe(false)
    expect(createAuditEventMock.mock.calls.some((c: any) => c[0].action === "PACKET_DOCUMENT_APPLICABILITY_RECONCILED")).toBe(false)
  })
})

describe("saveDocumentFields — 4c.3b: ownership, tenant, and trust boundary hardening", () => {
  it("rejects a field id belonging to a different packet the same way as any other foreign id", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: "field-from-another-packet", name: "X", fieldType: "text", value: "y", pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/do not belong to this document/i)
  })

  it("never trusts a client-supplied templateFieldKey on a submitted field — identity is always resolved from the field's own persisted row", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: "existing", reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    // Smuggle a fake templateFieldKey claiming this submission IS the
    // unconditional trigger field (which would be accepted); the server
    // must still resolve it as the real "dependent" field via its own id.
    const spoofed = { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "spoofed", pageNumber: 1, isRequired: false, templateFieldKey: "trigger" } as any
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      spoofed,
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate.mock.calls.some((c: any) => c[0].where.id === FIELD_DEPENDENT)).toBe(false)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
  })
})

describe("saveDocumentFields — 4c.3b: manual fields", () => {
  it("a new manual field is always accepted even while a sibling submission in the same batch is ignored", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: "x", reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted", pageNumber: 1, isRequired: false }, // hidden — ignored
      { name: "Manual Note", fieldType: "text", value: "hello", pageNumber: 1, isRequired: false }, // no id — always accepted
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ packetDocumentId: DOC_ID, source: "manual", value: "hello" }) })
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
  })

  it("a manual field's static isRequired participates in status calculation with no condition-evaluation error", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }, { id: FIELD_REQD }, { id: FIELD_SIG }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [{
        id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE",
        fields: [
          { id: FIELD_ID, templateFieldKey: "trigger", value: null, isRequired: false },
          { id: FIELD_DEPENDENT, templateFieldKey: "dependent", value: null, isRequired: false },
          { id: FIELD_REQD, templateFieldKey: "reqd_field", value: null, isRequired: false },
          { id: FIELD_SIG, templateFieldKey: "sig_field", value: "signed", isRequired: true },
          { id: "field-manual", templateFieldKey: null, value: null, isRequired: true }, // manual, always visible, statically required, empty
        ],
      }, { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_SIG, name: "Sig", fieldType: "signature", value: "signed", pageNumber: 1, isRequired: true },
    ])
    expect(result.success).toBe(true)
    // Every other condition-gated field is hidden or optional in this
    // state, so the manual field's own static, unconditional isRequired is
    // the only thing keeping the document from completing.
    if (result.success) expect(result.data.status).toBe("in_progress")
  })
})

describe("saveDocumentFields — 4c.3b: audit and response shape", () => {
  it("DOCUMENT_SAVED metadata contains exactly acceptedFieldCount, ignoredFieldCount, and status", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "existing answer", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted edit", pageNumber: 1, isRequired: false },
    ])
    const savedAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "DOCUMENT_SAVED")
    expect(savedAudit).toBeTruthy()
    expect(Object.keys(savedAudit![0].metadata).sort()).toEqual(["acceptedFieldCount", "ignoredFieldCount", "status"])
    expect(savedAudit![0].metadata.acceptedFieldCount).toBe(1)
    expect(savedAudit![0].metadata.ignoredFieldCount).toBe(1)
  })

  it("audit metadata never contains ignoredFieldIds, field names, values, or templateFieldKeys", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "existing answer", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted edit", pageNumber: 1, isRequired: false },
    ])
    const savedAudit = createAuditEventMock.mock.calls.find((c: any) => c[0].action === "DOCUMENT_SAVED")
    const serialized = JSON.stringify(savedAudit![0].metadata)
    expect(serialized).not.toMatch(/ignoredFieldIds|attempted edit|dependent|templateFieldKey/i)
  })

  it("ignoredFieldIds is returned in the action response but never appears in any audit event", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "existing answer", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted edit", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
    for (const call of createAuditEventMock.mock.calls) {
      expect(JSON.stringify(call[0].metadata ?? {})).not.toMatch(/ignoredFieldIds/i)
    }
  })
})

// ── Step 4c.3b clear-value fix ───────────────────────────────────────────
//
// Prisma silently omits an `undefined` value from an UPDATE's data object,
// leaving the row's previous value untouched — so a submitted `undefined`
// (meant to represent "cleared") previously evaluated as empty for THIS
// request's visibility/requiredness/status decisions without ever actually
// clearing the stored value. normalizeFieldValue() closes that gap at the
// single point every submitted value passes through before it is used for
// either evaluation or persistence.
describe("saveDocumentFields — 4c.3b clear-value fix: undefined normalizes to null consistently", () => {
  it("an existing field submitted with undefined is persisted as null, never as undefined", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_ID }, data: { value: null, posX: undefined, posY: undefined } })
    const call = pdfFieldUpdate.mock.calls.find((c: any) => c[0].where.id === FIELD_ID)
    expect(call![0].data).toHaveProperty("value", null)
    expect(call![0].data.value).not.toBeUndefined()
  })

  it("prospective evaluation receives a normalized null, not undefined — an undefined controller submission still hides its dependent", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    // trigger was previously checked ("true"); the batch submits undefined
    // for it (unchecking) alongside a dependent write — if the prospective
    // overlay used undefined instead of null, an evaluator bug could treat
    // it differently than an explicit null. It must not.
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "existing", reqd: "answer", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: "attempted while hiding", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
    expect(pdfFieldUpdate.mock.calls.some((c: any) => c[0].where.id === FIELD_DEPENDENT)).toBe(false)
  })

  it("final status calculation treats a persisted null exactly as empty", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_REQD }])
    // reqd_field is visible+required (trigger checked); submitting undefined
    // for it must be treated as empty by the status formula, keeping the
    // document in_progress rather than completed.
    // The mocked tx.packet.findUnique is static — it represents the state
    // the final (post-write) pass will read, so it's set here to already
    // reflect what the undefined submission correctly normalizes to (null),
    // matching the convention used by every other status test in this file.
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    if (result.success) expect(result.data.status).toBe("in_progress")
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_REQD }, data: { value: null, posX: undefined, posY: undefined } })
  })

  it("reconciliation reads the persisted null value, not a stale non-null one", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }])
    // trigger starts checked ("true"), so the sibling starts ACTIVE
    // (default packetSnapshotRow documents already reflect this). Submitting
    // undefined for trigger must actually clear it so reconciliation's own
    // fresh read sees it as unchecked and flips the sibling back to
    // CONDITIONALLY_INACTIVE — proving reconciliation reads the corrected
    // persisted value, not a value the write silently failed to clear.
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [
        { id: DOC_ID, documentTemplateId: "dtA", packetTemplateDocumentId: MAPPING_ID, applicabilityStatus: "ACTIVE", fields: [{ id: FIELD_ID, templateFieldKey: "trigger", value: null, isRequired: false }] },
        { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] },
      ],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    const call = packetDocumentUpdate.mock.calls.find((c: any) => c[0].where.id === DOC_SIBLING_ID)
    expect(call![0].data.applicabilityStatus).toBe("CONDITIONALLY_INACTIVE")
  })

  it("an empty string is preserved as an empty string and consistently treated as no meaningful value", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_REQD }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: "", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: "", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    // Stored exactly as submitted — "" is not further coerced to null.
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_REQD }, data: { value: "", posX: undefined, posY: undefined } })
    // But treated as empty for completion purposes.
    if (result.success) expect(result.data.status).toBe("in_progress")
  })

  it("a whitespace-only string is stored as entered but consistently treated as empty for completion", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_REQD }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: "true", dependent: "x", reqd: "   ", sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "ACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: "true", pageNumber: 1, isRequired: false },
      { id: FIELD_REQD, name: "Reqd", fieldType: "text", value: "   ", pageNumber: 1, isRequired: false },
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate).toHaveBeenCalledWith({ where: { id: FIELD_REQD }, data: { value: "   ", posX: undefined, posY: undefined } })
    if (result.success) expect(result.data.status).toBe("in_progress")
  })

  it("a new manual field never stores undefined, even when submitted with an undefined value", async () => {
    packetDocumentFindUnique.mockResolvedValue(legacyDoc())
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [{ name: "Manual Note", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false }])
    expect(result.success).toBe(true)
    expect(pdfFieldCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ packetDocumentId: DOC_ID, source: "manual", value: null }) })
    const call = pdfFieldCreate.mock.calls[0]
    expect(call[0].data.value).not.toBeUndefined()
  })

  it("a hidden, ignored field submitted with undefined issues no update and its stored value remains whatever it was", async () => {
    packetDocumentFindUnique.mockResolvedValue(conditionAwareDoc())
    pdfFieldFindMany.mockResolvedValue([{ id: FIELD_ID }, { id: FIELD_DEPENDENT }])
    txPacketFindUnique.mockResolvedValue(packetSnapshotRow({
      documents: [docWithFields({ trigger: null, dependent: "existing stored value", reqd: null, sig: "signed" }), { id: DOC_SIBLING_ID, documentTemplateId: "dtB", packetTemplateDocumentId: MAPPING_SIBLING, applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [] }],
    }))
    const { saveDocumentFields } = await import("@/lib/actions/documents")
    const result = await saveDocumentFields(DOC_ID, [
      { id: FIELD_ID, name: "Trigger", fieldType: "checkbox", value: undefined, pageNumber: 1, isRequired: false },
      { id: FIELD_DEPENDENT, name: "Dependent", fieldType: "text", value: undefined, pageNumber: 1, isRequired: false }, // hidden — attempted clear must be ignored
    ])
    expect(result.success).toBe(true)
    expect(pdfFieldUpdate.mock.calls.some((c: any) => c[0].where.id === FIELD_DEPENDENT)).toBe(false)
    if (result.success) expect(result.data.ignoredFieldIds).toEqual([FIELD_DEPENDENT])
  })
})
