import { describe, it, expect, vi, beforeEach } from "vitest"

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

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: STAFF_ID, activeOrganizationId: ORG_ID, isSuperAdmin: false, ...overrides } }
}

function ruleRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "rule-1", organizationId: ORG_ID, category: "required_field", severity: "critical",
    program: null, packetType: null, active: true, ...overrides,
  }
}

function basePacket(overrides: Record<string, unknown> = {}) {
  return {
    id: PACKET_ID, organizationId: ORG_ID, packetType: "initial_intake", status: "in_progress",
    dueDate: null, program: null, packetTemplate: null,
    documents: [], ...overrides,
  }
}

function requiredTextField(overrides: Record<string, unknown> = {}) {
  return { id: "field-1", name: "Client Name", fieldType: "text", value: null, isRequired: true, ...overrides }
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

  it("field-level required_field checks remain unchanged — a conditionally inactive document's empty required field is still flagged", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "ISP" }, fields: [requiredTextField()], isRequired: true, status: "completed", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ category: "required_field" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const messages = validationIssueCreate.mock.calls.map((c: any) => c[0].data.message)
    expect(messages.some((m: string) => m.includes("Required field"))).toBe(true)
  })

  it("field-level required_signature checks remain unchanged — a conditionally inactive document's missing signature is still flagged", async () => {
    packetFindUnique.mockResolvedValue(basePacket({
      documents: [{ id: "doc-1", documentTemplate: { name: "Consent" }, fields: [{ id: "sig-1", name: "Guardian Signature", fieldType: "signature", value: null, isRequired: true }], isRequired: true, status: "completed", applicabilityStatus: "CONDITIONALLY_INACTIVE" }],
    }))
    validationRuleFindMany.mockResolvedValue([ruleRow({ id: "rule-sig", category: "required_signature" })])

    const { runPacketValidation } = await import("@/lib/actions/validation")
    await runPacketValidation(PACKET_ID)

    const sigIssue = validationIssueCreate.mock.calls.find((c: any) => c[0].data.message.includes("Required signature"))
    expect(sigIssue).toBeTruthy()
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
