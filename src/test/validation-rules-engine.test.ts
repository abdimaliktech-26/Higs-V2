import { describe, it, expect, vi, beforeEach } from "vitest"
import * as conditionRuntimeModule from "@/lib/conditions/runtime"

// Step 4c.4b: runPacketValidation now transitively imports
// @/lib/conditions/runtime (real module, not mocked — only its own Prisma/
// auth/permissions/audit dependencies are mocked below), which itself
// imports "server-only" at module load time.
vi.mock("server-only", () => ({}))

const packetFindUnique = vi.fn()
const packetUpdate = vi.fn()
const validationRuleFindMany = vi.fn()
const validationRuleFindUnique = vi.fn()
const validationRuleUpdate = vi.fn()
const validationResultCreate = vi.fn()
const validationIssueCreate = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createAuditEventMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packet: {
      findUnique: (...a: unknown[]) => packetFindUnique(...a),
      update: (...a: unknown[]) => packetUpdate(...a),
    },
    validationRule: {
      findMany: (...a: unknown[]) => validationRuleFindMany(...a),
      findUnique: (...a: unknown[]) => validationRuleFindUnique(...a),
      update: (...a: unknown[]) => validationRuleUpdate(...a),
    },
    validationResult: { create: (...a: unknown[]) => validationResultCreate(...a) },
    validationIssue: { create: (...a: unknown[]) => validationIssueCreate(...a) },
  },
}))
vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => createAuditEventMock(...a) }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: { validation: {} },
  checkRateLimit: () => null,
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const STAFF_ID = "staff-1"
const PACKET_ID = "pkt-1"
const PACKET_TEMPLATE_ID = "pt-1"
const MAPPING_ID = "mapping-1"
const DOC_TEMPLATE_ID = "dt-1"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1", organizationId: ORG_ID, category: "required_field", severity: "critical",
    program: null, packetType: null, active: true, ...overrides,
  }
}

// Step 4c.4b: runPacketValidation now conditionally calls the real
// buildPacketConditionContext (from @/lib/conditions/runtime, not mocked in
// this file — only @/lib/db, @/lib/auth, @/lib/permissions, @/lib/audit,
// @/lib/rate-limit are mocked) whenever a required_field/required_signature
// rule is active. That function re-fetches the SAME packet via the same
// mocked prisma.packet.findUnique and re-derives org/parent-chain identity
// (client.organizationId, packetTemplate.id/organizationId, program.
// organizationId when set) — so the default fixture below is shaped as a
// genuine, resolvable LEGACY packet (valid client/packetTemplate, but no
// condition snapshot) rather than a packet that happens to fail
// buildPacketConditionContext by omission. This exercises the real legacy
// code path (isVisible: true, effectiveRequired === field.isRequired for
// every field) for every pre-existing test in this file, producing
// byte-identical results to before this step, rather than accidentally
// exercising the packet-level static-fallback path for the wrong reason.
function basePacket(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKET_ID, organizationId: ORG_ID, packetType: "initial_intake", status: "in_progress",
    dueDate: null, program: null, createdAt: new Date("2024-01-01"),
    client: { organizationId: ORG_ID, dateOfBirth: null },
    packetTemplate: { id: "pt-1", organizationId: ORG_ID, requiredDocs: [] },
    conditionSnapshotId: null, conditionRuntimeVersion: null, conditionSnapshot: null,
    documents: [], ...overrides,
  }
}

function requiredTextField(overrides: Record<string, unknown> = {}) {
  return { id: "field-1", name: "Client Name", fieldType: "text", value: null, isRequired: true, ...overrides }
}

// ── Step 4c.4b fixtures — a real condition-aware definition, exercised
// through the actual (unmocked) evaluator, mirroring the fixture pattern
// already used in src/test/documents-editable-dto.test.ts. "trigger" is a
// checkbox: CHECKED reveals/requires the other fields below.
function conditionDefinition() {
  return {
    schemaVersion: 1 as const,
    packetTemplateId: PACKET_TEMPLATE_ID,
    mappings: [{
      id: MAPPING_ID, documentTemplateId: DOC_TEMPLATE_ID, required: true, sortOrder: 0,
      conditionGroups: [],
      fields: [
        { id: "dtf-trigger", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] },
        {
          id: "dtf-hidden", fieldKey: "hidden_field", fieldType: "text", isRequired: true,
          conditionGroups: [{
            id: "grp-vis-hidden", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
            childGroups: [],
          }],
        },
        {
          id: "dtf-cond-opt", fieldKey: "cond_opt_field", fieldType: "text", isRequired: true,
          conditionGroups: [{
            id: "grp-req-opt", purpose: "FIELD_REQUIREDNESS" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
            childGroups: [],
          }],
        },
        {
          id: "dtf-cond-req", fieldKey: "cond_req_field", fieldType: "text", isRequired: false,
          conditionGroups: [{
            id: "grp-req", purpose: "FIELD_REQUIREDNESS" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
            childGroups: [],
          }],
        },
        {
          id: "dtf-sig", fieldKey: "sig_field", fieldType: "signature", isRequired: true,
          conditionGroups: [{
            id: "grp-vis-sig", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
            conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
            childGroups: [],
          }],
        },
      ],
    }],
  }
}

function conditionAwarePacket(overrides: Record<string, unknown> = {}) {
  return basePacket({
    packetTemplate: { id: PACKET_TEMPLATE_ID, organizationId: ORG_ID, requiredDocs: [] },
    conditionSnapshotId: "snap-1", conditionRuntimeVersion: 1,
    conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: conditionDefinition() },
    ...overrides,
  })
}

function triggerField(overrides: Record<string, unknown> = {}) {
  return { id: "trigger-1", name: "Trigger", fieldType: "checkbox", value: null, isRequired: false, templateFieldKey: "trigger", ...overrides }
}
function hiddenRequiredField(overrides: Record<string, unknown> = {}) {
  return { id: "hidden-1", name: "Hidden Field", fieldType: "text", value: null, isRequired: true, templateFieldKey: "hidden_field", ...overrides }
}
function condOptField(overrides: Record<string, unknown> = {}) {
  return { id: "condopt-1", name: "Cond Opt Field", fieldType: "text", value: null, isRequired: true, templateFieldKey: "cond_opt_field", ...overrides }
}
function condReqField(overrides: Record<string, unknown> = {}) {
  return { id: "condreq-1", name: "Cond Req Field", fieldType: "text", value: null, isRequired: false, templateFieldKey: "cond_req_field", ...overrides }
}
function conditionAwareSigField(overrides: Record<string, unknown> = {}) {
  return { id: "sig-cond-1", name: "Guardian Signature", fieldType: "signature", value: null, isRequired: true, templateFieldKey: "sig_field", ...overrides }
}

function conditionAwareDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: "doc-1", documentTemplateId: DOC_TEMPLATE_ID, documentTemplate: { name: "ISP" },
    packetTemplateDocumentId: MAPPING_ID, isRequired: true, status: "in_progress", applicabilityStatus: "ACTIVE",
    fields: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  requireOrgAccessMock.mockResolvedValue({})
  getActiveRoleMock.mockReturnValue("ORG_ADMIN")
  validationResultCreate.mockResolvedValue({ id: "result-1" })
  packetUpdate.mockResolvedValue({})
})

describe("runPacketValidation — required_field is rule-gated", () => {
  it("does not flag an empty required field when no active required_field rule exists", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "in_progress" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    // Only the always-on "incomplete document" check should fire — never the required-field check.
    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field"))).toBe(false)
  })

  it("flags an empty required field when a matching active required_field rule exists, using the rule's severity", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ severity: "warning" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const requiredFieldIssue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("Required field"))
    expect(requiredFieldIssue).toBeTruthy()
    expect(requiredFieldIssue![0].data.severity).toBe("warning")
    expect(requiredFieldIssue![0].data.validationRuleId).toBe("rule-1")
  })

  it("does not apply a rule scoped to a different packetType", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      packetType: "annual_review",
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ packetType: "initial_intake" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field"))).toBe(false)
  })

  it("applies a rule scoped to a matching program (by code)", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      program: { id: "prog-1", code: "WAIVER", name: "Waiver Program" },
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ program: "WAIVER" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field"))).toBe(true)
  })

  it("does not apply a rule scoped to a program the packet does not belong to", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      program: { id: "prog-1", code: "WAIVER", name: "Waiver Program" },
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ program: "OTHER_PROGRAM" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field"))).toBe(false)
  })

  it("an inactive rule is never fetched/applied (findMany itself only returns active: true rows)", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    expect(validationRuleFindMany.mock.calls[0][0].where.active).toBe(true)
  })
})

describe("runPacketValidation — required_signature (new rule-gated check)", () => {
  it("flags a missing required signature only when an active required_signature rule exists", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "Consent" }, fields: [{ id: "sig-1", name: "Guardian Signature", fieldType: "signature", value: null, isRequired: true }], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-sig", category: "required_signature", severity: "critical" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const sigIssue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("Required signature"))
    expect(sigIssue).toBeTruthy()
    expect(sigIssue![0].data.validationRuleId).toBe("rule-sig")
  })

  it("does not flag a missing signature when no required_signature rule is active", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "Consent" }, fields: [{ id: "sig-1", name: "Guardian Signature", fieldType: "signature", value: null, isRequired: true }], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required signature"))).toBe(false)
  })

  it("does not flag a non-signature required field under the required_signature rule", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-sig", category: "required_signature" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required signature"))).toBe(false)
  })
})

describe("runPacketValidation — missing_document and overdue_due_date are rule-gated", () => {
  it("does not flag a missing required document when no active missing_document rule exists", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      packetTemplate: { requiredDocs: [{ documentTemplateId: "dt-1" }] },
      documents: [],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("missing from packet"))).toBe(false)
  })

  it("flags a missing required document when an active missing_document rule exists", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      packetTemplate: { requiredDocs: [{ documentTemplateId: "dt-1" }] },
      documents: [],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-missing", category: "missing_document" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const issue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("missing from packet"))
    expect(issue![0].data.validationRuleId).toBe("rule-missing")
  })

  it("does not flag an overdue due date when no active overdue_due_date rule exists", async () => {
    packetFindUnique.mockResolvedValue(basePacket({ dueDate: new Date("2020-01-01"), status: "in_progress" }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("has passed"))).toBe(false)
  })

  it("flags an overdue due date when an active overdue_due_date rule exists", async () => {
    packetFindUnique.mockResolvedValue(basePacket({ dueDate: new Date("2020-01-01"), status: "in_progress" }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-overdue", category: "overdue_due_date", severity: "info" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const issue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("has passed"))
    expect(issue).toBeTruthy()
    expect(issue![0].data.severity).toBe("info")
  })
})

describe("runPacketValidation — always-on structural checks are unaffected by rules", () => {
  it("still flags an incomplete required document with zero active rules", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "in_progress" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("is in progress"))).toBe(true)
  })

  it("still flags pending signature routing with zero active rules", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      status: "awaiting_signature",
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: false, status: "in_progress" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("need completion before signatures"))).toBe(true)
  })
})

// ── Step 4c.4a — conditionally inactive PacketDocuments (applicabilityStatus
// persisted by the packet condition system, reconciled on every field save)
// are excluded from the document-level missing/incomplete checks only.
// No condition evaluation happens in validation.ts itself — the predicate
// reads the already-persisted column exactly as it comes back from Prisma.
describe("runPacketValidation — Step 4c.4a: conditionally inactive documents excluded from document-level rules", () => {
  it("still flags an active required incomplete document (unchanged from before this step)", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "in_progress", applicabilityStatus: "ACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes('Required document "ISP" is in progress'))).toBe(true)
  })

  it("does not flag a conditionally inactive required incomplete document", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "in_progress", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required document"))).toBe(false)
  })

  it("does not flag a conditionally inactive required missing (never-started) document", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "not_started", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required document"))).toBe(false)
  })

  it("an active required missing_document (fully absent) still produces the missing-document issue when the rule is active", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      packetTemplate: { requiredDocs: [{ documentTemplateId: "dt-1" }] },
      documents: [],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-missing", category: "missing_document" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const issue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("missing from packet"))
    expect(issue).toBeTruthy()
  })

  it("a conditionally inactive document that already exists for a required documentTemplateId produces no missing-document issue", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      packetTemplate: { requiredDocs: [{ documentTemplateId: "dt-1" }] },
      documents: [{ id: "doc-1", documentTemplateId: "dt-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "not_started", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-missing", category: "missing_document" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("missing from packet"))).toBe(false)
  })

  it("condition-aware filtering does not suppress unrelated validation issues (overdue due date still fires)", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      dueDate: new Date("2020-01-01"), status: "in_progress",
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "in_progress", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-overdue", category: "overdue_due_date", severity: "info" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("has passed"))).toBe(true)
    expect(messages.some((m: string) => m.includes("Required document"))).toBe(false)
  })

  // Superseded by Step 4c.4b: at the time this 4c.4a test was written,
  // field-level condition awareness was explicitly out of scope, so a
  // conditionally inactive document's fields were still checked by
  // required_field/required_signature exactly like an active document's.
  // Step 4c.4b's own approved scope explicitly reverses this — see the
  // "field-level condition-aware required_field/required_signature" describe
  // block below for the current, correct expectation.
  it("field-level required_field checks: a conditionally inactive document's empty required field produces no issue (superseded by Step 4c.4b)", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field"))).toBe(false)
  })

  it("field-level required_signature checks: a conditionally inactive document's missing signature produces no issue (superseded by Step 4c.4b)", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "Consent" }, fields: [{ id: "sig-1", name: "Guardian Signature", fieldType: "signature", value: null, isRequired: true }], isRequired: true, status: "completed", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-sig", category: "required_signature" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const sigIssue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("Required signature"))
    expect(sigIssue).toBeFalsy()
  })

  it("legacy documents without an applicabilityStatus field behave exactly as before this step", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [], isRequired: true, status: "in_progress" }],
    }))
    validationRuleFindMany.mockResolvedValue([])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes('Required document "ISP" is in progress'))).toBe(true)
  })
})

// ── Step 4c.4b — field-level condition-aware required_field/required_signature ──
describe("runPacketValidation — Step 4c.4b: field-level condition-aware required_field/required_signature", () => {
  it("1. a hidden statically required field produces no required-field issue", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: null }), hiddenRequiredField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Hidden Field"))).toBe(false)
  })

  it("2. a visible statically required empty field still produces the existing issue", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: "true" }), hiddenRequiredField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes('Required field "Hidden Field" is empty'))).toBe(true)
  })

  it("3. a statically required field with effectiveRequired === false produces no issue", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: null }), condOptField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Cond Opt Field"))).toBe(false)
  })

  it("4. a statically optional field with effectiveRequired === true produces the existing required-field issue when empty", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: "true" }), condReqField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes('Required field "Cond Req Field" is empty'))).toBe(true)
  })

  it("5. a hidden required signature field produces no required-signature issue", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: null }), conditionAwareSigField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-sig", category: "required_signature" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required signature"))).toBe(false)
  })

  it("6. a visible effectively required signature field retains existing behavior", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: "true" }), conditionAwareSigField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-sig", category: "required_signature" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const sigIssue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("Required signature"))
    expect(sigIssue).toBeTruthy()
  })

  it("7. a conditionally inactive document produces no field-level required or signature issues", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({
        applicabilityStatus: "CONDITIONALLY_INACTIVE",
        fields: [triggerField({ value: "true" }), hiddenRequiredField(), conditionAwareSigField()],
      })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" }), ruleRow({ id: "rule-sig", category: "required_signature" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field") || m.includes("Required signature"))).toBe(false)
  })

  it("8. a packet-level runtime build failure falls back to static validation for the whole packet", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      // A mismatched packetTemplate.organizationId makes requireAuthorizedPacket
      // (inside buildPacketConditionContext) throw — a genuine packet-level
      // runtime build failure, not a contrived test-only shortcut.
      packetTemplate: { id: PACKET_TEMPLATE_ID, organizationId: "org-OTHER", requiredDocs: [] },
      documents: [conditionAwareDoc({ fields: [triggerField({ value: null }), hiddenRequiredField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    // Under real condition evaluation this field would be hidden (trigger
    // unchecked) and produce no issue — the static fallback ignores that and
    // flags it purely on its persisted field.isRequired, proving the whole
    // packet fell back rather than silently treating the field as optional.
    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes('Required field "Hidden Field" is empty'))).toBe(true)
  })

  it("9. a document-level condition integrity error falls back to static validation for that document", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [
        // Broken: packetTemplateDocumentId does not resolve to any mapping
        // in the snapshot — a genuine, structural document-level integrity
        // error (missing_mapping), not a contrived shortcut.
        conditionAwareDoc({ id: "doc-broken", packetTemplateDocumentId: "no-such-mapping", fields: [{ id: "broken-f1", name: "Broken Doc Field", fieldType: "text", value: null, isRequired: true }] }),
        conditionAwareDoc({ id: "doc-healthy", fields: [triggerField({ value: null }), hiddenRequiredField()] }),
      ],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    // The broken document's field is flagged via static fallback (field.isRequired),
    // not silently hidden the way the editor's own fail-open default would.
    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Broken Doc Field"))).toBe(true)
  })

  it("10. an integrity error in one document does not force static fallback for other healthy documents", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [
        conditionAwareDoc({ id: "doc-broken", packetTemplateDocumentId: "no-such-mapping", fields: [{ id: "broken-f1", name: "Broken Doc Field", fieldType: "text", value: null, isRequired: true }] }),
        conditionAwareDoc({ id: "doc-healthy", fields: [triggerField({ value: null }), hiddenRequiredField()] }),
      ],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    // doc-healthy's hidden field must still be correctly excluded — proving
    // doc-broken's integrity error did not cascade into doc-healthy.
    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Hidden Field"))).toBe(false)
  })

  it("11. legacy packets retain existing static-validation behavior for required_field", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes('Required field "Client Name" is empty'))).toBe(true)
  })

  it("12. unrelated validation warnings and document-level rules remain unchanged alongside field-level condition awareness", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      dueDate: new Date("2020-01-01"), status: "in_progress",
      documents: [conditionAwareDoc({ fields: [triggerField({ value: null }), hiddenRequiredField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([
      ruleRow({ category: "required_field" }),
      ruleRow({ id: "rule-overdue", category: "overdue_due_date", severity: "info" }),
    ])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("has passed"))).toBe(true)
    expect(messages.some((m: string) => m.includes("Hidden Field"))).toBe(false)
  })

  it("13. multiple documents with different condition outcomes remain isolated", async () => {
    const MAPPING_A = "mapping-a"
    const MAPPING_B = "mapping-b"
    const definitionWithTwoMappings = {
      schemaVersion: 1 as const,
      packetTemplateId: PACKET_TEMPLATE_ID,
      mappings: [MAPPING_A, MAPPING_B].map((mappingId) => ({
        id: mappingId, documentTemplateId: `dt-${mappingId}`, required: true, sortOrder: 0,
        conditionGroups: [],
        fields: [
          { id: `dtf-trigger-${mappingId}`, fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] },
          {
            id: `dtf-hidden-${mappingId}`, fieldKey: "hidden_field", fieldType: "text", isRequired: true,
            conditionGroups: [{
              id: `grp-vis-${mappingId}`, purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
              conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
              childGroups: [],
            }],
          },
        ],
      })),
    }
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: definitionWithTwoMappings },
      documents: [
        conditionAwareDoc({ id: "doc-a", documentTemplateId: `dt-${MAPPING_A}`, packetTemplateDocumentId: MAPPING_A, documentTemplate: { name: "Doc A" }, fields: [triggerField({ value: "true" }), hiddenRequiredField()] }),
        conditionAwareDoc({ id: "doc-b", documentTemplateId: `dt-${MAPPING_B}`, packetTemplateDocumentId: MAPPING_B, documentTemplate: { name: "Doc B" }, fields: [triggerField({ value: null }), hiddenRequiredField()] }),
      ],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    // Scoped to required_field messages specifically — an unrelated,
    // always-on document-level "is in progress" message legitimately
    // mentions both documents by name and must not be mistaken for a
    // field-level false positive here.
    const requiredFieldMessages = messages.filter((m: string) => m.startsWith("Required field"))
    expect(requiredFieldMessages.some((m: string) => m.includes('"Hidden Field" is empty in Doc A'))).toBe(true)
    expect(requiredFieldMessages.some((m: string) => m.includes("Doc B"))).toBe(false)
  })

  it("14. builds the condition runtime once per validation run, not once per document or field", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [
        conditionAwareDoc({ id: "doc-1", fields: [triggerField({ value: null }), hiddenRequiredField({ id: "h1" })] }),
        conditionAwareDoc({ id: "doc-2", fields: [triggerField({ value: null }), hiddenRequiredField({ id: "h2" })] }),
        conditionAwareDoc({ id: "doc-3", fields: [triggerField({ value: null }), hiddenRequiredField({ id: "h3" })] }),
      ],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    // 1 call from runPacketValidation's own fetch + 2 from buildPacketConditionContext
    // (requireAuthorizedPacket's fetch + its own PACKET_CONTEXT_INCLUDE fetch) —
    // fixed regardless of document/field count, never scaling with either.
    expect(packetFindUnique).toHaveBeenCalledTimes(3)
  })

  it("15. uses only persisted state — buildPacketConditionContext is called with just the packetId, never an overlay of unsaved values", async () => {
    const spy = vi.spyOn(conditionRuntimeModule, "buildPacketConditionContext")
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      documents: [conditionAwareDoc({ fields: [triggerField({ value: null }), hiddenRequiredField()] })],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    expect(spy).toHaveBeenCalledWith(PACKET_ID)
    expect(spy.mock.calls[0].length).toBe(1)
    spy.mockRestore()
  })

  it("16. a genuinely packet-wide integrity error (malformed snapshot, no document/mapping id) falls back to static validation for every document", async () => {
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      // Not a valid PacketConditionDefinition shape (missing schemaVersion/
      // mappings) — isDefinition() rejects it, producing "malformed_snapshot",
      // which carries neither a packetDocumentId nor a mappingId and so must
      // apply uniformly to every document in the packet.
      conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: { not: "a valid definition" } },
      documents: [
        conditionAwareDoc({ id: "doc-a", fields: [{ id: "fa1", name: "Doc A Field", fieldType: "text", value: null, isRequired: true, templateFieldKey: null }] }),
        conditionAwareDoc({ id: "doc-b", fields: [{ id: "fb1", name: "Doc B Field", fieldType: "text", value: null, isRequired: true, templateFieldKey: null }] }),
      ],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    // Both documents' statically required empty fields are flagged via
    // static fallback — neither was spared by the broken snapshot.
    const requiredFieldMessages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message).filter((m: string) => m.startsWith("Required field"))
    expect(requiredFieldMessages.some((m: string) => m.includes("Doc A Field"))).toBe(true)
    expect(requiredFieldMessages.some((m: string) => m.includes("Doc B Field"))).toBe(true)
  })

  it("17. an integrity error tagged with a mapping id (mapping_document_mismatch) is associated with the correct document only", async () => {
    const MAPPING_HEALTHY = "mapping-healthy"
    // A real packet has one PacketDocument per PacketTemplateDocument mapping
    // (never two documents sharing one mapping id), so the healthy document
    // here is given its own separate, valid mapping in the same snapshot —
    // otherwise a shared mapping id would make this scenario unrepresentative
    // of any real packet shape.
    const definitionWithHealthyMapping = {
      schemaVersion: 1 as const,
      packetTemplateId: PACKET_TEMPLATE_ID,
      mappings: [
        ...conditionDefinition().mappings,
        {
          id: MAPPING_HEALTHY, documentTemplateId: "dt-healthy", required: true, sortOrder: 1,
          conditionGroups: [],
          fields: [
            { id: "dtf-trigger-healthy", fieldKey: "trigger", fieldType: "checkbox", isRequired: false, conditionGroups: [] },
            {
              id: "dtf-hidden-healthy", fieldKey: "hidden_field", fieldType: "text", isRequired: true,
              conditionGroups: [{
                id: "grp-vis-healthy", purpose: "FIELD_VISIBILITY" as const, logicOperator: "AND" as const,
                conditions: [{ sourceType: "TEMPLATE_FIELD" as const, sourceFieldKey: "trigger", sourcePacketTemplateDocumentId: null, operator: "CHECKED" as const, comparisonValue: null }],
                childGroups: [],
              }],
            },
          ],
        },
      ],
    }
    packetFindUnique.mockResolvedValue(conditionAwarePacket({
      conditionSnapshot: { id: "snap-1", organizationId: ORG_ID, packetTemplateId: PACKET_TEMPLATE_ID, runtimeVersion: 1, clientIsMinor: false, definition: definitionWithHealthyMapping },
      documents: [
        // Resolves to a real mapping (MAPPING_ID), but its own documentTemplateId
        // doesn't match that mapping's documentTemplateId — this specific
        // integrity error type carries BOTH mappingId and packetDocumentId,
        // giving direct evidence that a mapping-tagged error is still routed
        // to the one document it actually concerns.
        conditionAwareDoc({ id: "doc-mismatched", documentTemplateId: "wrong-doc-template", packetTemplateDocumentId: MAPPING_ID, fields: [{ id: "fm1", name: "Mismatched Doc Field", fieldType: "text", value: null, isRequired: true, templateFieldKey: null }] }),
        conditionAwareDoc({ id: "doc-healthy", documentTemplateId: "dt-healthy", packetTemplateDocumentId: MAPPING_HEALTHY, fields: [triggerField({ value: null }), hiddenRequiredField()] }),
      ],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const requiredFieldMessages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message).filter((m: string) => m.startsWith("Required field"))
    // The mismatched document falls back to static and is flagged.
    expect(requiredFieldMessages.some((m: string) => m.includes("Mismatched Doc Field"))).toBe(true)
    // The healthy document (its own, distinct mapping) is unaffected and its
    // hidden field is still correctly excluded.
    expect(requiredFieldMessages.some((m: string) => m.includes("Hidden Field"))).toBe(false)
  })
})

describe("updateValidationRuleActive", () => {
  it("deactivates a rule and records a VALIDATION_RULE_STATUS_CHANGED audit event", async () => {
    validationRuleFindUnique.mockResolvedValue({ id: "rule-1", organizationId: ORG_ID, active: true })
    validationRuleUpdate.mockResolvedValue({})

    const { updateValidationRuleActive } = await import("@/lib/actions/validation")
    const result = await updateValidationRuleActive("rule-1", false)

    expect(result.success).toBe(true)
    expect(validationRuleUpdate).toHaveBeenCalledWith({ where: { id: "rule-1" }, data: { active: false } })
    const auditCall = createAuditEventMock.mock.calls[0][0]
    expect(auditCall.action).toBe("VALIDATION_RULE_STATUS_CHANGED")
    expect(auditCall.metadata).toEqual({ active: false })
  })

  it("rejects a role not permitted to manage rules", async () => {
    getActiveRoleMock.mockReturnValue("DSP")
    const { updateValidationRuleActive } = await import("@/lib/actions/validation")
    const result = await updateValidationRuleActive("rule-1", false)
    expect(result.success).toBe(false)
    expect(validationRuleFindUnique).not.toHaveBeenCalled()
  })

  it("rejects a nonexistent rule", async () => {
    validationRuleFindUnique.mockResolvedValue(null)
    const { updateValidationRuleActive } = await import("@/lib/actions/validation")
    const result = await updateValidationRuleActive("does-not-exist", false)
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/not found/i)
  })

  it("rejects cross-tenant rule toggling", async () => {
    validationRuleFindUnique.mockResolvedValue({ id: "rule-1", organizationId: "org-OTHER", active: true })
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))
    const { updateValidationRuleActive } = await import("@/lib/actions/validation")
    await expect(updateValidationRuleActive("rule-1", false)).rejects.toThrow("Access denied")
    expect(validationRuleUpdate).not.toHaveBeenCalled()
  })
})
