import { beforeEach, describe, expect, it, vi } from "vitest"
import type { PacketConditionRuntime } from "@/lib/conditions/runtime-types"

vi.mock("server-only", () => ({}))

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const packetFindUnique = vi.fn()
const mappingFindMany = vi.fn()
const snapshotCreate = vi.fn()
const packetUpdate = vi.fn()
const auditMock = vi.fn()
const validatePacketMock = vi.fn()
const validateTemplateMock = vi.fn()

const tx = {
  packet: { findUnique: (...args: unknown[]) => packetFindUnique(...args), update: (...args: unknown[]) => packetUpdate(...args) },
  packetConditionSnapshot: { create: (...args: unknown[]) => snapshotCreate(...args) },
  auditEvent: { create: vi.fn() },
}

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }))
vi.mock("@/lib/permissions", () => ({ requireOrgAccess: (...args: unknown[]) => requireOrgAccessMock(...args) }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => auditMock(...args) }))
vi.mock("@/lib/actions/template-conditions", () => ({
  validatePacketTemplateConditions: (...args: unknown[]) => validatePacketMock(...args),
  validateTemplateConditions: (...args: unknown[]) => validateTemplateMock(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    packet: { findUnique: (...args: unknown[]) => packetFindUnique(...args) },
    packetTemplateDocument: { findMany: (...args: unknown[]) => mappingFindMany(...args) },
    $transaction: (callback: any) => callback(tx),
  },
}))

const ORG = "org-1"
const PACKET = "packet-1"
const TEMPLATE = "packet-template-1"
const MAPPING = "mapping-1"
const DOC_TEMPLATE = "doc-template-1"
const SNAPSHOT = "snapshot-1"
const CREATED_AT = new Date("2020-06-15T12:00:00.000Z")

function authPacket(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKET,
    organizationId: ORG,
    packetTemplateId: TEMPLATE,
    packetType: "initial_intake",
    programId: null,
    createdAt: CREATED_AT,
    conditionSnapshotId: null,
    conditionRuntimeVersion: null,
    client: { organizationId: ORG, dateOfBirth: new Date("2005-07-01T00:00:00.000Z") },
    packetTemplate: { id: TEMPLATE, organizationId: ORG },
    program: null,
    ...overrides,
  }
}

const visibilityGroup = {
  id: "visibility-root",
  purpose: "FIELD_VISIBILITY",
  logicOperator: "AND",
  conditions: [{
    id: "condition-1", sortOrder: 0, sourceType: "TEMPLATE_FIELD", sourceFieldKey: "trigger",
    sourcePacketTemplateDocumentId: null, operator: "CHECKED", comparisonValue: null,
  }],
  childGroups: [{
    id: "nested", purpose: "FIELD_VISIBILITY", logicOperator: "OR", conditions: [{
      id: "nested-condition", sortOrder: 0, sourceType: "PACKET_TYPE", sourceFieldKey: null,
      sourcePacketTemplateDocumentId: null, operator: "EQUALS", comparisonValue: "initial_intake",
    }], childGroups: [],
  }],
}

function mappingFixture() {
  return {
    id: MAPPING, documentTemplateId: DOC_TEMPLATE, required: true, sortOrder: 0,
    conditionGroups: [{
      id: "document-root", purpose: "DOCUMENT_INCLUSION", logicOperator: "AND",
      conditions: [{
        id: "cross-condition", sortOrder: 0, sourceType: "TEMPLATE_FIELD", sourceFieldKey: "trigger",
        sourcePacketTemplateDocumentId: MAPPING, operator: "CHECKED", comparisonValue: null,
      }], childGroups: [],
    }],
    documentTemplate: {
      organizationId: ORG,
      fields: [
        { id: "dtf-trigger", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, sortOrder: 0, conditionGroups: [] },
        { id: "dtf-detail", fieldKey: "detail", fieldType: "text", isRequired: true, sortOrder: 1, conditionGroups: [visibilityGroup] },
      ],
    },
  }
}

function definition() {
  return {
    schemaVersion: 1 as const,
    packetTemplateId: TEMPLATE,
    mappings: [{
      id: MAPPING, documentTemplateId: DOC_TEMPLATE, required: true, sortOrder: 0,
      conditionGroups: [],
      fields: [
        { id: "dtf-trigger", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] },
        { id: "dtf-detail", fieldKey: "detail", fieldType: "text", isRequired: true, conditionGroups: [{
          id: "visibility-root", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
          conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }], childGroups: [],
        }] },
      ],
    }],
  }
}

function runtime(overrides: Partial<PacketConditionRuntime> = {}): PacketConditionRuntime {
  return {
    mode: "snapshot", packetId: PACKET, organizationId: ORG, packetCreatedAt: CREATED_AT,
    packetType: "initial_intake", programCode: null, client: { isMinor: true }, snapshotId: SNAPSHOT,
    runtimeVersion: 1, definition: definition(),
    packetDocumentsByMappingId: {
      [MAPPING]: {
        id: "packet-doc", mappingId: MAPPING, documentTemplateId: DOC_TEMPLATE, staticRequired: true,
        applicabilityStatus: "ACTIVE", fieldValues: { trigger: "true", detail: null },
        fieldsById: {
          trigger: { id: "trigger", templateFieldKey: "trigger", documentTemplateFieldId: "dtf-trigger", value: "true", staticRequired: false },
          detail: { id: "detail", templateFieldKey: "detail", documentTemplateFieldId: "dtf-detail", value: null, staticRequired: true },
        },
      },
    },
    packetDocumentsById: { "packet-doc": { id: "packet-doc", isRequired: true, applicabilityStatus: "ACTIVE", packetTemplateDocumentId: MAPPING } },
    pdfFieldsById: {
      trigger: { id: "trigger", packetDocumentId: "packet-doc", isRequired: false, templateFieldKey: "trigger" },
      detail: { id: "detail", packetDocumentId: "packet-doc", isRequired: true, templateFieldKey: "detail" },
    },
    documentFieldValues: { [MAPPING]: { trigger: "true", detail: null } }, integrityErrors: [], ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue({ user: { id: "staff-1", activeOrganizationId: ORG } })
  requireOrgAccessMock.mockResolvedValue({})
  validatePacketMock.mockResolvedValue({ valid: true, errors: [] })
  validateTemplateMock.mockResolvedValue({ valid: true, errors: [] })
  mappingFindMany.mockResolvedValue([mappingFixture()])
  snapshotCreate.mockImplementation(async ({ data }: any) => ({ id: SNAPSHOT, ...data }))
  packetUpdate.mockResolvedValue({})
})

describe("condition snapshot foundation", () => {
  it("creates an immutable definition snapshot preserving owners, nesting, and cross-document anchors", async () => {
    packetFindUnique.mockImplementation(async ({ include, select }: any) => select ? { conditionSnapshotId: null, conditionRuntimeVersion: null } : authPacket())
    const { createPacketConditionSnapshot } = await import("@/lib/conditions/runtime")
    const result = await createPacketConditionSnapshot(PACKET)
    expect(result).toEqual({ id: SNAPSHOT, runtimeVersion: 1 })
    const stored = snapshotCreate.mock.calls[0][0].data
    expect(stored.clientIsMinor).toBe(true)
    expect(stored.evaluationReferenceAt).toEqual(CREATED_AT)
    expect(stored.definition.mappings[0].conditionGroups[0].conditions[0].sourcePacketTemplateDocumentId).toBe(MAPPING)
    expect(stored.definition.mappings[0].fields[1].conditionGroups[0].childGroups[0].id).toBe("nested")
    expect(JSON.stringify(stored)).not.toContain("dateOfBirth")
    expect(JSON.stringify(stored)).not.toContain("2005-07-01")
    expect(packetUpdate).toHaveBeenCalledWith({ where: { id: PACKET }, data: { conditionSnapshotId: SNAPSHOT, conditionRuntimeVersion: 1 } })
  })

  it("uses packet creation time for the frozen minor result", async () => {
    packetFindUnique.mockImplementation(async ({ select }: any) => select ? { conditionSnapshotId: null, conditionRuntimeVersion: null } : authPacket())
    const { createPacketConditionSnapshot } = await import("@/lib/conditions/runtime")
    await createPacketConditionSnapshot(PACKET)
    expect(snapshotCreate.mock.calls[0][0].data.clientIsMinor).toBe(true)
  })

  it("blocks malformed template definitions", async () => {
    packetFindUnique.mockResolvedValue(authPacket())
    validatePacketMock.mockResolvedValue({ valid: false, errors: [{ type: "empty_group" }] })
    const { createPacketConditionSnapshot } = await import("@/lib/conditions/runtime")
    await expect(createPacketConditionSnapshot(PACKET)).rejects.toThrow("invalid condition")
    expect(snapshotCreate).not.toHaveBeenCalled()
  })

  it("rejects cross-tenant parent chains", async () => {
    packetFindUnique.mockResolvedValue(authPacket({ client: { organizationId: "other-org", dateOfBirth: null } }))
    const { createPacketConditionSnapshot } = await import("@/lib/conditions/runtime")
    await expect(createPacketConditionSnapshot(PACKET)).rejects.toThrow("organization mismatch")
  })

  it("writes only safe snapshot audit metadata", async () => {
    packetFindUnique.mockImplementation(async ({ select }: any) => select ? { conditionSnapshotId: null, conditionRuntimeVersion: null } : authPacket())
    const { createPacketConditionSnapshot } = await import("@/lib/conditions/runtime")
    await createPacketConditionSnapshot(PACKET)
    const audit = auditMock.mock.calls[0][0]
    expect(audit.metadata).toEqual({ packetId: PACKET, packetTemplateId: TEMPLATE, snapshotId: SNAPSHOT, runtimeVersion: 1, action: "snapshot_created" })
    expect(JSON.stringify(audit)).not.toContain("dateOfBirth")
    expect(JSON.stringify(audit)).not.toContain("comparisonValue")
  })
})

describe("runtime context and evaluation", () => {
  it("returns static legacy mode without DOB or runtime writes", async () => {
    packetFindUnique.mockImplementation(async ({ include }: any) => include?.client ? authPacket() : ({
      ...authPacket(), client: undefined, packetTemplate: undefined, conditionSnapshot: null, documents: [], program: null,
    }))
    const { buildPacketConditionContext } = await import("@/lib/conditions/runtime")
    const context = await buildPacketConditionContext(PACKET)
    expect(context.mode).toBe("legacy")
    expect(context.client.isMinor).toBeNull()
    expect(JSON.stringify(context)).not.toContain("dateOfBirth")
    expect(packetUpdate).not.toHaveBeenCalled()
  })

  it("resolves values by mapping id + stable field key and uses frozen pseudo-fields", async () => {
    packetFindUnique.mockImplementation(async ({ include }: any) => include?.client ? authPacket({ conditionSnapshotId: SNAPSHOT, conditionRuntimeVersion: 1 }) : ({
      ...authPacket({ conditionSnapshotId: SNAPSHOT, conditionRuntimeVersion: 1 }), client: undefined, packetTemplate: undefined,
      program: { code: "cadi" },
      conditionSnapshot: { id: SNAPSHOT, organizationId: ORG, packetTemplateId: TEMPLATE, runtimeVersion: 1, clientIsMinor: true, definition: definition() },
      documents: [{
        id: "packet-doc", packetTemplateDocumentId: MAPPING, documentTemplateId: DOC_TEMPLATE,
        isRequired: true, applicabilityStatus: "ACTIVE",
        fields: [{ id: "trigger", templateFieldKey: "trigger", documentTemplateFieldId: "dtf-trigger", value: "true", isRequired: false }],
      }],
    }))
    const { buildPacketConditionContext } = await import("@/lib/conditions/runtime")
    const context = await buildPacketConditionContext(PACKET)
    expect(context.mode).toBe("snapshot")
    expect(context.documentFieldValues[MAPPING].trigger).toBe("true")
    expect(context.programCode).toBe("cadi")
    expect(context.client.isMinor).toBe(true)
    expect(JSON.stringify(context)).not.toContain("dateOfBirth")
  })

  it("applies no-condition defaults and manual-field visibility", async () => {
    const { evaluatePacketDocumentInclusion, evaluatePacketDocumentRequiredness, evaluatePdfFieldVisibility } = await import("@/lib/conditions/runtime")
    expect(evaluatePacketDocumentInclusion(runtime(), MAPPING)).toMatchObject({ status: "evaluated", result: true })
    expect(evaluatePacketDocumentRequiredness(runtime(), MAPPING)).toMatchObject({ status: "evaluated", result: true })
    const manual = runtime()
    manual.packetDocumentsByMappingId[MAPPING].fieldsById.manual = { id: "manual", templateFieldKey: null, documentTemplateFieldId: null, value: null, staticRequired: false }
    expect(evaluatePdfFieldVisibility(manual, "packet-doc", "manual")).toMatchObject({ status: "evaluated", result: true })
  })

  it("evaluates same-document visibility and requiredness by stable key", async () => {
    const { evaluatePdfFieldVisibility, evaluatePdfFieldRequiredness } = await import("@/lib/conditions/runtime")
    expect(evaluatePdfFieldVisibility(runtime(), "packet-doc", "detail")).toMatchObject({ status: "evaluated", result: true })
    expect(evaluatePdfFieldRequiredness(runtime(), "packet-doc", "detail")).toMatchObject({ status: "evaluated", result: true })
    const unchecked = runtime()
    unchecked.packetDocumentsByMappingId[MAPPING].fieldValues.trigger = null
    expect(evaluatePdfFieldVisibility(unchecked, "packet-doc", "detail")).toMatchObject({ status: "evaluated", result: false })
    expect(evaluatePdfFieldRequiredness(unchecked, "packet-doc", "detail")).toMatchObject({ status: "evaluated", result: false })
  })

  it("distinguishes known-empty inputs from integrity errors", async () => {
    const { evaluatePdfFieldVisibility } = await import("@/lib/conditions/runtime")
    const empty = runtime()
    empty.packetDocumentsByMappingId[MAPPING].fieldValues.trigger = null
    const evaluated = evaluatePdfFieldVisibility(empty, "packet-doc", "detail")
    expect(evaluated).toMatchObject({ status: "evaluated", result: false })
    if (evaluated.status === "evaluated") expect(evaluated.knownEmptyInputs).toContain("trigger")
    const broken = runtime({ integrityErrors: [{ type: "malformed_snapshot", message: "broken" }] })
    expect(evaluatePdfFieldVisibility(broken, "packet-doc", "detail")).toMatchObject({ status: "integrity_error" })
  })
})

function legacyRuntime(overrides: Partial<PacketConditionRuntime> = {}): PacketConditionRuntime {
  return {
    mode: "legacy", packetId: PACKET, organizationId: ORG, packetCreatedAt: CREATED_AT,
    packetType: "initial_intake", programCode: null, client: { isMinor: null }, snapshotId: null,
    runtimeVersion: null, definition: null, packetDocumentsByMappingId: {},
    packetDocumentsById: { "legacy-doc": { id: "legacy-doc", isRequired: true, applicabilityStatus: "ACTIVE", packetTemplateDocumentId: null } },
    pdfFieldsById: { "legacy-field": { id: "legacy-field", packetDocumentId: "legacy-doc", isRequired: true, templateFieldKey: null } },
    documentFieldValues: {}, integrityErrors: [], ...overrides,
  }
}

describe("legacy requiredness — real persisted values, no condition logic", () => {
  it("legacy PacketDocument with isRequired=true returns true", async () => {
    const { evaluatePacketDocumentRequiredness } = await import("@/lib/conditions/runtime")
    const result = evaluatePacketDocumentRequiredness(legacyRuntime(), "legacy-doc")
    expect(result).toMatchObject({ status: "evaluated", result: true })
  })

  it("legacy PacketDocument with isRequired=false returns false", async () => {
    const { evaluatePacketDocumentRequiredness } = await import("@/lib/conditions/runtime")
    const rt = legacyRuntime({ packetDocumentsById: { "legacy-doc": { id: "legacy-doc", isRequired: false, applicabilityStatus: "ACTIVE", packetTemplateDocumentId: null } } })
    const result = evaluatePacketDocumentRequiredness(rt, "legacy-doc")
    expect(result).toMatchObject({ status: "evaluated", result: false })
  })

  it("legacy PdfField with isRequired=true returns true, and visibility remains true", async () => {
    const { evaluatePdfFieldRequiredness, evaluatePdfFieldVisibility } = await import("@/lib/conditions/runtime")
    const rt = legacyRuntime()
    expect(evaluatePdfFieldRequiredness(rt, "legacy-doc", "legacy-field")).toMatchObject({ status: "evaluated", result: true })
    expect(evaluatePdfFieldVisibility(rt, "legacy-doc", "legacy-field")).toMatchObject({ status: "evaluated", result: true })
  })

  it("legacy PdfField with isRequired=false returns false", async () => {
    const { evaluatePdfFieldRequiredness } = await import("@/lib/conditions/runtime")
    const rt = legacyRuntime({ pdfFieldsById: { "legacy-field": { id: "legacy-field", packetDocumentId: "legacy-doc", isRequired: false, templateFieldKey: null } } })
    const result = evaluatePdfFieldRequiredness(rt, "legacy-doc", "legacy-field")
    expect(result).toMatchObject({ status: "evaluated", result: false })
  })

  it("a missing PacketDocument id returns a structured integrity error, never a silent false", async () => {
    const { evaluatePacketDocumentRequiredness } = await import("@/lib/conditions/runtime")
    const result = evaluatePacketDocumentRequiredness(legacyRuntime(), "does-not-exist")
    expect(result.status).toBe("integrity_error")
    if (result.status === "integrity_error") expect(result.errors[0]).toMatchObject({ type: "missing_packet_document", packetDocumentId: "does-not-exist" })
  })

  it("a missing PdfField id returns a structured integrity error, never a silent false", async () => {
    const { evaluatePdfFieldRequiredness } = await import("@/lib/conditions/runtime")
    const result = evaluatePdfFieldRequiredness(legacyRuntime(), "legacy-doc", "does-not-exist")
    expect(result.status).toBe("integrity_error")
    if (result.status === "integrity_error") expect(result.errors[0]).toMatchObject({ type: "missing_field", fieldId: "does-not-exist" })
  })

  it("does not infer legacy requiredness through packetDocumentsByMappingId even if it happens to be populated", async () => {
    const { evaluatePacketDocumentRequiredness } = await import("@/lib/conditions/runtime")
    // A mapping-keyed entry with a conflicting staticRequired must never be consulted for legacy evaluation.
    const rt = legacyRuntime({
      packetDocumentsByMappingId: { "some-mapping": { id: "legacy-doc", mappingId: "some-mapping", documentTemplateId: "dt", staticRequired: false, applicabilityStatus: "ACTIVE", fieldsById: {}, fieldValues: {} } },
    })
    const result = evaluatePacketDocumentRequiredness(rt, "legacy-doc")
    expect(result).toMatchObject({ status: "evaluated", result: true })
  })
})

