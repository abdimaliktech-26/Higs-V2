// Stage 5 Step 4c.3a — server-authoritative editor DTO: field visibility,
// effective requiredness, document-level condition state, all read-only.
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("server-only", () => ({}))

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()
const packetDocumentFindUnique = vi.fn()
const packetFindUnique = vi.fn()
const requireDocumentAccessMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: { findUnique: (...a: unknown[]) => packetDocumentFindUnique(...a) },
    packet: { findUnique: (...a: unknown[]) => packetFindUnique(...a) },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/live-authorization", () => ({
  requireDocumentAccess: (...a: unknown[]) => requireDocumentAccessMock(...a),
}))
vi.mock("@/lib/storage", () => ({ signUrl: () => "https://example.com/signed" }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const OTHER_ORG_ID = "org-2"
const STAFF_ID = "staff-1"
const PACKET_ID = "pkt-1"
const DOC_ID = "doc-1"
const PACKET_TEMPLATE_ID = "pt-1"
const MAPPING_ID = "mapping-1"
const DOC_TEMPLATE_ID = "dtA"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function definitionFixture(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1 as const,
    packetTemplateId: PACKET_TEMPLATE_ID,
    mappings: [{
      id: MAPPING_ID, documentTemplateId: DOC_TEMPLATE_ID, required: true, sortOrder: 0,
      conditionGroups: [],
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
        {
          id: "dtf-reqd", fieldKey: "reqd_field", fieldType: "text", isRequired: false,
          conditionGroups: [{
            id: "grp-req", purpose: "FIELD_REQUIREDNESS" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
            childGroups: [],
          }],
        },
      ],
      ...overrides,
    }],
  }
}

function pdfFieldRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "field-1", packetDocumentId: DOC_ID, name: "Field", fieldType: "text", value: null,
    pageNumber: 1, posX: null, posY: null, width: null, height: null, confidence: 1,
    source: "template", isRequired: false, sortOrder: 0, templateFieldKey: null, documentTemplateFieldId: null,
    ...overrides,
  }
}

function packetRow(overrides: Record<string, unknown> = {}) {
  const conditionSnapshotId = "conditionSnapshotId" in overrides ? overrides.conditionSnapshotId : "snap-1"
  const conditionRuntimeVersion = "conditionRuntimeVersion" in overrides ? overrides.conditionRuntimeVersion : 1
  return {
    id: PACKET_ID, organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID,
    packetType: "initial_intake", status: "draft", createdAt: new Date("2024-01-01T00:00:00.000Z"),
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
    id: DOC_ID, packetId: PACKET_ID, documentTemplateId: DOC_TEMPLATE_ID, status: "pending",
    isRequired: true, sortOrder: 0, currentVersion: 0, applicabilityStatus: "ACTIVE", packetTemplateDocumentId: MAPPING_ID,
    updatedAt: new Date("2024-01-01T00:00:00.000Z"),
    documentTemplate: { id: DOC_TEMPLATE_ID, name: "Doc A", fileKey: null, formType: "dhs" },
    packet: packetRow(),
    fields: [pdfFieldRow()],
    versions: [], comments: [],
    ...overrides,
  }
}

// Keeps the two independent mocked packet.findUnique callers (runtime.ts's
// requireAuthorizedPacket, and buildPacketConditionContext's own second
// call) and the outer packetDocument.findUnique consistent with each other:
// the packet's own `documents` list must include this same PacketDocument
// (with the same field rows) for reconciliation-adjacent context building.
function wireConsistentFixtures(docOverrides: Record<string, unknown> = {}, packetOverrides: Record<string, unknown> = {}) {
  const doc = packetDocumentRow(docOverrides)
  const packet = packetRow({ ...packetOverrides, documents: [{ id: doc.id, documentTemplateId: doc.documentTemplateId, packetTemplateDocumentId: doc.packetTemplateDocumentId, applicabilityStatus: doc.applicabilityStatus, isRequired: doc.isRequired, fields: doc.fields }] })
  // The outer packetDocument.findUnique query selects only id/firstName/
  // lastName/mcadId for packet.client, and never includes conditionSnapshot
  // at all (see src/lib/actions/documents.ts); the raw definition/DOB are
  // only ever read by runtime.ts's own separate packet.findUnique calls
  // (requireAuthorizedPacket, buildPacketConditionContext), which use
  // `packet` below, not `doc.packet`. Keeping these shapes distinct here
  // mirrors production and lets the leak tests exercise the real selects.
  const { conditionSnapshot: _omittedSnapshot, ...packetWithoutSnapshot } = packet
  doc.packet = {
    ...packetWithoutSnapshot,
    client: { id: "client-1", firstName: "Test", lastName: "Client", mcadId: "MCAD-1" },
  } as unknown as typeof doc.packet
  packetDocumentFindUnique.mockResolvedValue(doc)
  packetFindUnique.mockResolvedValue(packet)
  return { doc, packet }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue({})
  getActiveRoleMock.mockReturnValue("CASE_MANAGER")
  requireDocumentAccessMock.mockResolvedValue({
    userId: STAFF_ID, organizationId: ORG_ID, role: "CASE_MANAGER",
    isGlobalSuperAdmin: false, isCrossTenantSuperAdmin: false,
    selectedOrganizationId: ORG_ID, membershipId: "membership-1",
    email: "staff@example.com", name: "Staff", clientId: "client-1",
    isAssignedToClient: true, packetId: PACKET_ID, documentId: DOC_ID,
  })
})

describe("getEditableDocument — legacy packets (unchanged behavior)", () => {
  it("every field is visible with effectiveRequired equal to persisted isRequired", async () => {
    wireConsistentFixtures(
      { fields: [pdfFieldRow({ id: "f1", isRequired: true, value: null }), pdfFieldRow({ id: "f2", isRequired: false, value: "x" })] },
      { conditionSnapshotId: null, conditionRuntimeVersion: null }
    )
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)

    expect(result.conditionMode).toBe("legacy")
    expect(result.isConditionAware).toBe(false)
    expect(result.fields.every((f: any) => f.isVisible === true)).toBe(true)
    expect(result.fields.find((f: any) => f.id === "f1")).toMatchObject({ isRequired: true, staticRequired: true, effectiveRequired: true })
    expect(result.fields.find((f: any) => f.id === "f2")).toMatchObject({ isRequired: false, staticRequired: false, effectiveRequired: false })
  })

  it("manual fields (no templateFieldKey) are visible and use static requiredness", async () => {
    wireConsistentFixtures(
      { fields: [pdfFieldRow({ id: "f-manual", templateFieldKey: null, source: "manual", isRequired: true })] },
      { conditionSnapshotId: null, conditionRuntimeVersion: null }
    )
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.fields[0]).toMatchObject({ isVisible: true, effectiveRequired: true, visibilityConditionPresent: false, requirednessConditionPresent: false })
  })

  it("reports no condition integrity error state", async () => {
    wireConsistentFixtures({}, { conditionSnapshotId: null, conditionRuntimeVersion: null })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.hasConditionIntegrityError).toBe(false)
    expect(result.conditionConfigurationError).toBe(false)
    expect(result.conditionIntegrityErrorCount).toBe(0)
  })

  it("preserves the existing editable-document shape the current client reads", async () => {
    wireConsistentFixtures({}, { conditionSnapshotId: null, conditionRuntimeVersion: null })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result).toMatchObject({ isReadOnly: false, isLockedByApproval: false, pdfUrl: null })
    expect(result.fields[0]).toHaveProperty("isRequired")
    expect(result.fields[0]).toHaveProperty("value")
    expect(result.fields[0]).toHaveProperty("fieldType")
  })
})

describe("getEditableDocument — condition-aware visibility", () => {
  it("a field with no controlling condition and a satisfied trigger is visible", async () => {
    wireConsistentFixtures({
      fields: [
        pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: "true" }),
        pdfFieldRow({ id: "f-dependent", templateFieldKey: "dependent", value: null }),
      ],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const dependent = result.fields.find((f: any) => f.id === "f-dependent")!
    expect(dependent.isVisible).toBe(true)
    expect(dependent.visibilityConditionPresent).toBe(true)
  })

  it("a field whose visibility condition resolves false is hidden, but its value is retained in the payload", async () => {
    wireConsistentFixtures({
      fields: [
        pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: null }),
        pdfFieldRow({ id: "f-dependent", templateFieldKey: "dependent", value: "leftover answer" }),
      ],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const dependent = result.fields.find((f: any) => f.id === "f-dependent")!
    expect(dependent.isVisible).toBe(false)
    expect(dependent.value).toBe("leftover answer")
  })

  it("a hidden field always has effectiveRequired=false regardless of its static value", async () => {
    wireConsistentFixtures({
      fields: [
        pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: null }),
        pdfFieldRow({ id: "f-dependent", templateFieldKey: "dependent", value: null, isRequired: true }),
      ],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const dependent = result.fields.find((f: any) => f.id === "f-dependent")!
    expect(dependent.isVisible).toBe(false)
    expect(dependent.effectiveRequired).toBe(false)
  })

  it("a requiredness condition resolving true marks the field conditionallyRequired", async () => {
    wireConsistentFixtures({
      fields: [
        pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: "true" }),
        pdfFieldRow({ id: "f-reqd", templateFieldKey: "reqd_field", value: null, isRequired: false }),
      ],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const reqd = result.fields.find((f: any) => f.id === "f-reqd")!
    expect(reqd.effectiveRequired).toBe(true)
    expect(reqd.staticRequired).toBe(false)
    expect(reqd.conditionallyRequired).toBe(true)
    expect(reqd.requirednessConditionPresent).toBe(true)
  })

  it("a requiredness condition resolving false leaves the field optional even though visible", async () => {
    wireConsistentFixtures({
      fields: [
        pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: null }),
        pdfFieldRow({ id: "f-reqd", templateFieldKey: "reqd_field", value: null, isRequired: false }),
      ],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const reqd = result.fields.find((f: any) => f.id === "f-reqd")!
    expect(reqd.isVisible).toBe(true)
    expect(reqd.effectiveRequired).toBe(false)
    expect(reqd.conditionallyRequired).toBe(false)
  })

  it("a field with no requiredness condition uses its static value", async () => {
    wireConsistentFixtures({ fields: [pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: null, isRequired: true })] })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const trigger = result.fields.find((f: any) => f.id === "f-trigger")!
    expect(trigger.effectiveRequired).toBe(true)
    expect(trigger.requirednessConditionPresent).toBe(false)
  })

  it("a manual field inside a condition-aware document still uses static visible/required behavior", async () => {
    wireConsistentFixtures({ fields: [pdfFieldRow({ id: "f-manual", templateFieldKey: null, source: "manual", isRequired: true })] })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const manual = result.fields.find((f: any) => f.id === "f-manual")!
    expect(manual).toMatchObject({ isVisible: true, effectiveRequired: true, visibilityConditionPresent: false, requirednessConditionPresent: false })
  })

  it("same-document condition values resolve by templateFieldKey, not field id", async () => {
    wireConsistentFixtures({
      fields: [
        pdfFieldRow({ id: "totally-different-id", templateFieldKey: "trigger", value: "true" }),
        pdfFieldRow({ id: "f-dependent", templateFieldKey: "dependent", value: null }),
      ],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.fields.find((f: any) => f.id === "f-dependent")!.isVisible).toBe(true)
  })

  it("pseudo-fields resolve correctly (PACKET_TYPE-gated visibility)", async () => {
    const definition = {
      schemaVersion: 1 as const, packetTemplateId: PACKET_TEMPLATE_ID,
      mappings: [{
        id: MAPPING_ID, documentTemplateId: DOC_TEMPLATE_ID, required: true, sortOrder: 0, conditionGroups: [],
        fields: [{
          id: "dtf-pt", fieldKey: "pt_gated", fieldType: "text", isRequired: false,
          conditionGroups: [{ id: "grp-pt", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const, conditions: [{ sourceType: "PACKET_TYPE" as const, sourceFieldKey: null, sourcePacketTemplateDocumentId: null, operator: "EQUALS" as const, comparisonValue: "initial_intake" }], childGroups: [] }],
        }],
      }],
    }
    wireConsistentFixtures(
      { fields: [pdfFieldRow({ id: "f-pt", templateFieldKey: "pt_gated", value: null })] },
      { conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition } }
    )
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.fields.find((f: any) => f.id === "f-pt")!.isVisible).toBe(true)
  })
})

describe("getEditableDocument — document applicability state", () => {
  it("an ACTIVE document remains editable when the role otherwise allows it", async () => {
    wireConsistentFixtures({ applicabilityStatus: "ACTIVE" })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.isReadOnly).toBe(false)
    expect(result.readOnlyReason).toBeNull()
  })

  it("a CONDITIONALLY_INACTIVE document loads read-only with a safe reason, fields and values intact", async () => {
    wireConsistentFixtures({ applicabilityStatus: "CONDITIONALLY_INACTIVE", fields: [pdfFieldRow({ id: "f1", value: "kept" })] })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.isReadOnly).toBe(true)
    expect(result.readOnlyReason).toBe("This document is currently not applicable based on packet conditions.")
    expect(result.applicabilityStatus).toBe("CONDITIONALLY_INACTIVE")
    expect(result.fields[0].value).toBe("kept")
  })

  it("loading an inactive document performs no reconciliation write and only the normal DOCUMENT_VIEWED audit event", async () => {
    wireConsistentFixtures({ applicabilityStatus: "CONDITIONALLY_INACTIVE" })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await getEditableDocument(DOC_ID)
    expect(createAuditEventMock).toHaveBeenCalledTimes(1)
    expect(createAuditEventMock.mock.calls[0][0].action).toBe("DOCUMENT_VIEWED")
  })
})

describe("getEditableDocument — integrity errors", () => {
  it("a malformed snapshot produces a read-only configuration-error state without raw internal details", async () => {
    wireConsistentFixtures({}, { conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { broken: true } } })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.isReadOnly).toBe(true)
    expect(result.hasConditionIntegrityError).toBe(true)
    expect(result.conditionConfigurationError).toBe(true)
    expect(result.readOnlyReason).toBe("This document has a compliance configuration error and cannot be edited until it is resolved.")
    expect(JSON.stringify(result.readOnlyReason)).not.toMatch(/broken_snapshot|malformed_snapshot|missing_field_key/i)
  })

  it("a PdfField referencing a templateFieldKey absent from the snapshot produces a configuration-error state", async () => {
    wireConsistentFixtures({ fields: [pdfFieldRow({ id: "f-ghost", templateFieldKey: "does_not_exist_in_snapshot", value: "x" })] })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.hasConditionIntegrityError).toBe(true)
    expect(result.isReadOnly).toBe(true)
  })

  it("still allows the page to load (not blocked entirely) and preserves field values for inspection", async () => {
    wireConsistentFixtures({ fields: [pdfFieldRow({ id: "f-ghost", templateFieldKey: "does_not_exist_in_snapshot", value: "still here" })] })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.fields.find((f: any) => f.id === "f-ghost")!.value).toBe("still here")
  })

  it("does not report a global broken-snapshot error as one problem per field", async () => {
    wireConsistentFixtures(
      { fields: [pdfFieldRow({ id: "f1" }), pdfFieldRow({ id: "f2" }), pdfFieldRow({ id: "f3" })] },
      { conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { broken: true } } }
    )
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    expect(result.conditionIntegrityErrorCount).toBe(1)
  })
})

describe("getEditableDocument — authorization and tenant safety", () => {
  it("rejects an unauthenticated caller", async () => {
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await expect(getEditableDocument(DOC_ID)).rejects.toThrow("Access denied")
  })

  it("rejects cross-tenant document access", async () => {
    wireConsistentFixtures({}, {})
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await expect(getEditableDocument(DOC_ID)).rejects.toThrow("Access denied")
  })

  it("rejects a nonexistent document without leaking anything about it", async () => {
    packetDocumentFindUnique.mockResolvedValue(null)
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await expect(getEditableDocument("does-not-exist")).rejects.toThrow("Document not found")
  })

  it("rejects a role with no editor access at all", async () => {
    wireConsistentFixtures({}, {})
    requireDocumentAccessMock.mockRejectedValue(new Error("Access denied"))
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await expect(getEditableDocument(DOC_ID)).rejects.toThrow("Access denied")
  })

  it("never includes raw DOB or condition comparison values anywhere in the response", async () => {
    wireConsistentFixtures(
      { fields: [pdfFieldRow({ id: "f-trigger", templateFieldKey: "trigger", value: "true" })] },
      { client: { organizationId: ORG_ID, dateOfBirth: new Date("2010-05-01") } }
    )
    const { getEditableDocument } = await import("@/lib/actions/documents")
    const result = await getEditableDocument(DOC_ID)
    const serialized = JSON.stringify(result)
    expect(serialized).not.toContain("2010-05-01")
    expect(serialized).not.toContain("dateOfBirth")
    expect(serialized).not.toContain("comparisonValue")
  })
})

describe("getEditableDocument — performance and structure", () => {
  it("calls buildPacketConditionContext's underlying packet lookup a bounded, small number of times per request (not once per field)", async () => {
    wireConsistentFixtures({
      fields: [pdfFieldRow({ id: "f1" }), pdfFieldRow({ id: "f2" }), pdfFieldRow({ id: "f3" }), pdfFieldRow({ id: "f4" }), pdfFieldRow({ id: "f5" })],
    })
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await getEditableDocument(DOC_ID)
    // requireAuthorizedPacket's own lookup + buildPacketConditionContext's own lookup = 2, regardless of field count.
    expect(packetFindUnique).toHaveBeenCalledTimes(2)
    expect(packetDocumentFindUnique).toHaveBeenCalledTimes(1)
  })
})

describe("getEditableDocument — compatibility", () => {
  it("does not touch saveDocumentFields or any write path", async () => {
    wireConsistentFixtures({}, {})
    const { getEditableDocument } = await import("@/lib/actions/documents")
    await getEditableDocument(DOC_ID)
    // Only the read-side mocks exist in this file's db mock at all — a write
    // call would throw (cannot read property of undefined) if one occurred.
    expect(createAuditEventMock).toHaveBeenCalledTimes(1)
  })
})
