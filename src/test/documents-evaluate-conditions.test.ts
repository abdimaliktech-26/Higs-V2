// Stage 5 Step 4c.3c.2 — evaluateDocumentFieldConditions: debounced,
// read-only condition evaluation for the editor's real-time hide/show and
// conditional-requiredness feedback. No writes, no audits, no condition
// trees/field keys/comparison values in the response.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const packetDocumentFindUnique = vi.fn()
const packetFindUnique = vi.fn()
const pdfFieldFindMany = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a) },
    packet: { findUnique: (...a: unknown[]) => packetFindUnique(...a) },
    pdfField: { findMany: (...a: unknown[]) => pdfFieldFindMany(...a) },
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
const PACKET_TEMPLATE_ID = "pt-1"
const MAPPING_ID = "mapping-1"
const FIELD_ID = "field-trigger"
const FIELD_DEPENDENT = "field-dependent"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function definitionFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    packetTemplateId: PACKET_TEMPLATE_ID,
    mappings: [{
      id: MAPPING_ID, documentTemplateId: "dtA", required: true, sortOrder: 0, conditionGroups: [],
      fields: [
        { id: "dtf-trigger", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] },
        {
          id: "dtf-dependent", fieldKey: "dependent", fieldType: "text", isRequired: false,
          conditionGroups: [{
            id: "grp-vis", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
            childGroups: [],
          }],
        },
      ],
      ...overrides,
    }],
  }
}

function packetRow(overrides: Record<string, unknown> = {}) {
  const conditionSnapshotId = "conditionSnapshotId" in overrides ? overrides.conditionSnapshotId : "snap-1"
  const conditionRuntimeVersion = "conditionRuntimeVersion" in overrides ? overrides.conditionRuntimeVersion : 1
  return {
    id: PACKET_ID, organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, status: "draft",
    packetType: "initial_intake", createdAt: new Date("2024-01-01T00:00:00.000Z"),
    conditionSnapshotId, conditionRuntimeVersion,
    client: { organizationId: ORG_ID, dateOfBirth: null },
    program: { name: "CADI", code: "cadi", organizationId: ORG_ID },
    packetTemplate: { id: PACKET_TEMPLATE_ID, organizationId: ORG_ID },
    assignedTo: null,
    conditionSnapshot: conditionSnapshotId
      ? { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: definitionFixture() }
      : null,
    documents: [],
    ...overrides,
  }
}

function packetDocumentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, packetId: PACKET_ID, documentTemplateId: "dtA", status: "pending",
    isRequired: true, applicabilityStatus: "ACTIVE", packetTemplateDocumentId: MAPPING_ID,
    packet: packetRow(),
    ...overrides,
  }
}

function wireConsistentFixtures(docOverrides: Record<string, unknown> = {}, packetOverrides: Record<string, unknown> = {}, docFields: Record<string, unknown>[] = [{ id: FIELD_ID, templateFieldKey: "trigger", isRequired: false }]) {
  const doc = packetDocumentRow(docOverrides)
  const packet = packetRow({ ...packetOverrides, documents: [{ id: doc.id, documentTemplateId: doc.documentTemplateId, packetTemplateDocumentId: doc.packetTemplateDocumentId, applicabilityStatus: doc.applicabilityStatus, isRequired: doc.isRequired, fields: docFields.map((f) => ({ ...f, value: null, documentTemplateFieldId: null })) }] })
  doc.packet = packet
  packetDocumentFindUnique.mockResolvedValue(doc)
  packetFindUnique.mockResolvedValue(packet)
  pdfFieldFindMany.mockResolvedValue(docFields)
  return { doc, packet }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue({})
  getActiveRoleMock.mockReturnValue("CASE_MANAGER")
})

describe("evaluateDocumentFieldConditions — basic authenticated evaluation", () => {
  it("returns isVisible/effectiveRequired/conditionallyRequired for every field", async () => {
    wireConsistentFixtures({}, {}, [
      { id: FIELD_ID, templateFieldKey: "trigger", isRequired: false },
      { id: FIELD_DEPENDENT, templateFieldKey: "dependent", isRequired: false },
    ])
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "true" }, { id: FIELD_DEPENDENT, value: null }])
    expect(result.success).toBe(true)
    if (!result.success) return
    const fields = (result.data as any).fields
    expect(fields[FIELD_ID]).toEqual({ isVisible: true, effectiveRequired: false, conditionallyRequired: false })
    expect(fields[FIELD_DEPENDENT]).toEqual({ isVisible: true, effectiveRequired: false, conditionallyRequired: false })
  })

  it("hides the dependent field when the prospective trigger value is unchecked", async () => {
    wireConsistentFixtures({}, {}, [
      { id: FIELD_ID, templateFieldKey: "trigger", isRequired: false },
      { id: FIELD_DEPENDENT, templateFieldKey: "dependent", isRequired: false },
    ])
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: null }, { id: FIELD_DEPENDENT, value: "attempted" }])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.data as any).fields[FIELD_DEPENDENT].isVisible).toBe(false)
  })
})

describe("evaluateDocumentFieldConditions — legacy documents", () => {
  it("returns an empty, correct result without evaluating anything", async () => {
    wireConsistentFixtures({}, { conditionSnapshotId: null, conditionRuntimeVersion: null })
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "x" }])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.data as any).fields).toEqual({})
    expect(pdfFieldFindMany).not.toHaveBeenCalled()
  })
})

describe("evaluateDocumentFieldConditions — authorization and tenant safety", () => {
  it("rejects an unauthenticated caller", async () => {
    authMock.mockResolvedValue(null)
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/unauthorized/i)
    expect(packetDocumentFindUnique).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant document access", async () => {
    wireConsistentFixtures()
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/access denied/i)
  })

  it("rejects a role with no editor access at all", async () => {
    wireConsistentFixtures()
    getActiveRoleMock.mockReturnValue("BILLING_ADMIN")
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/insufficient permissions/i)
  })

  it("rejects a nonexistent document without leaking anything about it", async () => {
    packetDocumentFindUnique.mockResolvedValue(null)
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions("does-not-exist", [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it("rejects a foreign field id that does not belong to this document", async () => {
    wireConsistentFixtures()
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: "field-from-elsewhere", value: "x" }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/do not belong to this document/i)
  })

  it("rejects evaluation for a CONDITIONALLY_INACTIVE document", async () => {
    wireConsistentFixtures({ applicabilityStatus: "CONDITIONALLY_INACTIVE" })
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document is currently not applicable based on packet conditions and cannot be edited.")
  })

  it("rejects evaluation for an approved packet", async () => {
    wireConsistentFixtures({}, { status: "approved" })
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document is approved and locked for editing.")
  })
})

describe("evaluateDocumentFieldConditions — normalization, snapshot trust, integrity", () => {
  it("normalizes an undefined submitted value the same way saveDocumentFields does", async () => {
    wireConsistentFixtures({}, {}, [
      { id: FIELD_ID, templateFieldKey: "trigger", isRequired: false },
      { id: FIELD_DEPENDENT, templateFieldKey: "dependent", isRequired: false },
    ])
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    // trigger submitted as undefined (representing "cleared") must be
    // treated as unchecked/empty, hiding the dependent field.
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: undefined }, { id: FIELD_DEPENDENT, value: "x" }])
    expect(result.success).toBe(true)
    if (!result.success) return
    expect((result.data as any).fields[FIELD_DEPENDENT].isVisible).toBe(false)
  })

  it("evaluates purely from the immutable snapshot — no live template/condition tables are ever queried", async () => {
    // No templateConditionGroup/documentTemplateField mocks are wired into
    // this test file's @/lib/db mock at all — if evaluation touched either,
    // this would throw (cannot read property of undefined).
    wireConsistentFixtures()
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "true" }])
    expect(result.success).toBe(true)
  })

  it("returns a safe generic message on a broken snapshot, never internal details", async () => {
    wireConsistentFixtures({}, { conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { broken: true } } })
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "true" }])
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    expect(result.error).not.toMatch(/malformed|snapshot|broken/i)
  })
})

describe("evaluateDocumentFieldConditions — no side effects", () => {
  it("performs no database writes and creates no audit event", async () => {
    wireConsistentFixtures()
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "true" }])
    // The mocked @/lib/db module in this file only exposes findUnique/
    // findMany — a write call would throw if one occurred.
    expect(createAuditEventMock).not.toHaveBeenCalled()
  })
})

describe("evaluateDocumentFieldConditions — response safety", () => {
  it("never includes condition trees, field keys, operators, comparison values, or raw DOB in the response", async () => {
    wireConsistentFixtures({}, { client: { organizationId: ORG_ID, dateOfBirth: new Date("2010-05-01") } }, [
      { id: FIELD_ID, templateFieldKey: "trigger", isRequired: false },
      { id: FIELD_DEPENDENT, templateFieldKey: "dependent", isRequired: false },
    ])
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "true" }, { id: FIELD_DEPENDENT, value: null }])
    const serialized = JSON.stringify(result)
    expect(serialized).not.toMatch(/2010-05-01|dateOfBirth|comparisonValue|sourceFieldKey|operator|CHECKED|templateFieldKey|conditionGroups/i)
  })

  it("returns only isVisible, effectiveRequired, and conditionallyRequired per field id — no other keys", async () => {
    wireConsistentFixtures()
    const { evaluateDocumentFieldConditions } = await import("@/lib/actions/documents")
    const result = await evaluateDocumentFieldConditions(DOC_ID, [{ id: FIELD_ID, value: "true" }])
    expect(result.success).toBe(true)
    if (!result.success) return
    const view = (result.data as any).fields[FIELD_ID]
    expect(Object.keys(view).sort()).toEqual(["conditionallyRequired", "effectiveRequired", "isVisible"])
  })
})
