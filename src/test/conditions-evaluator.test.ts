import { describe, it, expect } from "vitest"
import { evaluateCondition, evaluateGroup, evaluateConditionTree } from "@/lib/conditions/evaluator"
import { resolveCompatibilityKind, isOperatorCompatible, validateComparisonValueShape } from "@/lib/conditions/operator-compatibility"
import type { EvaluationCondition, EvaluationContext, EvaluationGroup } from "@/lib/conditions/types"

function ctx(overrides: Partial<EvaluationContext> = {}): EvaluationContext {
  return {
    fieldValues: {},
    client: { isMinor: false },
    packet: { programCode: null, packetType: "initial_intake" },
    ...overrides,
  }
}

function fieldCondition(overrides: Partial<EvaluationCondition> = {}): EvaluationCondition {
  return { sourceType: "TEMPLATE_FIELD", sourceFieldKey: "status", operator: "EQUALS", comparisonValue: "active", ...overrides }
}

describe("evaluateCondition — every operator", () => {
  it("EQUALS: matches case-insensitively", () => {
    const r = evaluateCondition(fieldCondition({ operator: "EQUALS", comparisonValue: "Active" }), ctx({ fieldValues: { status: "active" } }))
    expect(r.result).toBe(true)
  })

  it("EQUALS: mismatched value is false", () => {
    const r = evaluateCondition(fieldCondition({ operator: "EQUALS", comparisonValue: "closed" }), ctx({ fieldValues: { status: "active" } }))
    expect(r.result).toBe(false)
  })

  it("NOT_EQUALS: true when different", () => {
    const r = evaluateCondition(fieldCondition({ operator: "NOT_EQUALS", comparisonValue: "closed" }), ctx({ fieldValues: { status: "active" } }))
    expect(r.result).toBe(true)
  })

  it("NOT_EQUALS: false when same", () => {
    const r = evaluateCondition(fieldCondition({ operator: "NOT_EQUALS", comparisonValue: "active" }), ctx({ fieldValues: { status: "active" } }))
    expect(r.result).toBe(false)
  })

  it("CONTAINS: substring match, case-insensitive", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "notes", operator: "CONTAINS", comparisonValue: "MED" }), ctx({ fieldValues: { notes: "needs medication support" } }))
    expect(r.result).toBe(true)
  })

  it("CONTAINS: no match", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "notes", operator: "CONTAINS", comparisonValue: "xyz" }), ctx({ fieldValues: { notes: "needs medication support" } }))
    expect(r.result).toBe(false)
  })

  it("NOT_EMPTY: true when present", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "notes", operator: "NOT_EMPTY", comparisonValue: undefined }), ctx({ fieldValues: { notes: "hello" } }))
    expect(r.result).toBe(true)
  })

  it("NOT_EMPTY: false when blank string", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "notes", operator: "NOT_EMPTY" }), ctx({ fieldValues: { notes: "   " } }))
    expect(r.result).toBe(false)
  })

  it("EMPTY: true when missing entirely", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "notes", operator: "EMPTY" }), ctx({ fieldValues: {} }))
    expect(r.result).toBe(true)
  })

  it("EMPTY: false when present", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "notes", operator: "EMPTY" }), ctx({ fieldValues: { notes: "x" } }))
    expect(r.result).toBe(false)
  })

  it("CHECKED: true for boolean true and truthy strings", () => {
    for (const value of [true, "true", "on", "yes", "1", 1]) {
      const r = evaluateCondition(fieldCondition({ sourceFieldKey: "confirm", operator: "CHECKED" }), ctx({ fieldValues: { confirm: value } }))
      expect(r.result).toBe(true)
    }
  })

  it("CHECKED: false when missing/false", () => {
    const r1 = evaluateCondition(fieldCondition({ sourceFieldKey: "confirm", operator: "CHECKED" }), ctx({ fieldValues: {} }))
    const r2 = evaluateCondition(fieldCondition({ sourceFieldKey: "confirm", operator: "CHECKED" }), ctx({ fieldValues: { confirm: false } }))
    expect(r1.result).toBe(false)
    expect(r2.result).toBe(false)
  })

  it("UNCHECKED: true when missing (default state)", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "confirm", operator: "UNCHECKED" }), ctx({ fieldValues: {} }))
    expect(r.result).toBe(true)
  })

  it("UNCHECKED: false when checked", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "confirm", operator: "UNCHECKED" }), ctx({ fieldValues: { confirm: true } }))
    expect(r.result).toBe(false)
  })

  it("GREATER_THAN: numeric comparison", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "age", operator: "GREATER_THAN", comparisonValue: 18 }), ctx({ fieldValues: { age: "21" } }))
    expect(r.result).toBe(true)
  })

  it("LESS_THAN: numeric comparison", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "age", operator: "LESS_THAN", comparisonValue: 18 }), ctx({ fieldValues: { age: "12" } }))
    expect(r.result).toBe(true)
  })

  it("GREATER_THAN: date comparison fallback", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "reviewDate", operator: "GREATER_THAN", comparisonValue: "2020-01-01" }), ctx({ fieldValues: { reviewDate: "2021-06-01" } }))
    expect(r.result).toBe(true)
  })

  it("BEFORE: true when resolved date is earlier", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "dueDate", operator: "BEFORE", comparisonValue: "2025-01-01" }), ctx({ fieldValues: { dueDate: "2024-01-01" } }))
    expect(r.result).toBe(true)
  })

  it("AFTER: true when resolved date is later", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "dueDate", operator: "AFTER", comparisonValue: "2024-01-01" }), ctx({ fieldValues: { dueDate: "2025-01-01" } }))
    expect(r.result).toBe(true)
  })

  it("IN: true when resolved value is one of the array", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "program", operator: "IN", comparisonValue: ["WAIVER", "CADI"] }), ctx({ fieldValues: { program: "cadi" } }))
    expect(r.result).toBe(true)
  })

  it("NOT_IN: true when resolved value is not in the array", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "program", operator: "NOT_IN", comparisonValue: ["WAIVER"] }), ctx({ fieldValues: { program: "CADI" } }))
    expect(r.result).toBe(true)
  })
})

describe("evaluateCondition — missing/null/empty/malformed values", () => {
  it("missing field value: EQUALS is false, NOT_EQUALS is true", () => {
    expect(evaluateCondition(fieldCondition({ operator: "EQUALS" }), ctx()).result).toBe(false)
    expect(evaluateCondition(fieldCondition({ operator: "NOT_EQUALS" }), ctx()).result).toBe(true)
  })

  it("null field value treated as empty", () => {
    const r = evaluateCondition(fieldCondition({ operator: "EQUALS" }), ctx({ fieldValues: { status: null } }))
    expect(r.result).toBe(false)
  })

  it("IN with missing value is false; NOT_IN with missing value is true", () => {
    expect(evaluateCondition(fieldCondition({ operator: "IN", comparisonValue: ["a"] }), ctx()).result).toBe(false)
    expect(evaluateCondition(fieldCondition({ operator: "NOT_IN", comparisonValue: ["a"] }), ctx()).result).toBe(true)
  })

  it("malformed date comparison (unparseable) evaluates false, never throws", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "dueDate", operator: "BEFORE", comparisonValue: "not-a-date" }), ctx({ fieldValues: { dueDate: "also-not-a-date" } }))
    expect(r.result).toBe(false)
  })

  it("malformed numeric comparison (non-numeric, non-date) evaluates false", () => {
    const r = evaluateCondition(fieldCondition({ sourceFieldKey: "age", operator: "GREATER_THAN", comparisonValue: "abc" }), ctx({ fieldValues: { age: "xyz" } }))
    expect(r.result).toBe(false)
  })

  it("IN with a non-array comparisonValue evaluates false rather than throwing", () => {
    const r = evaluateCondition(fieldCondition({ operator: "IN", comparisonValue: "not-an-array" as any }), ctx({ fieldValues: { status: "active" } }))
    expect(r.result).toBe(false)
  })
})

describe("evaluateCondition — pseudo-fields", () => {
  it("CLIENT_IS_MINOR resolves from client context", () => {
    const r = evaluateCondition({ sourceType: "CLIENT_IS_MINOR", sourceFieldKey: null, operator: "EQUALS", comparisonValue: true }, ctx({ client: { isMinor: true } }))
    expect(r.result).toBe(true)
  })

  it("PACKET_PROGRAM_CODE resolves from packet context", () => {
    const r = evaluateCondition({ sourceType: "PACKET_PROGRAM_CODE", sourceFieldKey: null, operator: "EQUALS", comparisonValue: "CADI" }, ctx({ packet: { programCode: "cadi", packetType: "initial_intake" } }))
    expect(r.result).toBe(true)
  })

  it("PACKET_TYPE resolves from packet context", () => {
    const r = evaluateCondition({ sourceType: "PACKET_TYPE", sourceFieldKey: null, operator: "EQUALS", comparisonValue: "45_day" }, ctx({ packet: { programCode: null, packetType: "45_day" } }))
    expect(r.result).toBe(true)
  })

  it("PACKET_PROGRAM_CODE with IN operator against multiple codes", () => {
    const r = evaluateCondition({ sourceType: "PACKET_PROGRAM_CODE", sourceFieldKey: null, operator: "IN", comparisonValue: ["CADI", "BI"] }, ctx({ packet: { programCode: "BI", packetType: "initial_intake" } }))
    expect(r.result).toBe(true)
  })
})

describe("evaluateGroup — AND/OR/nested", () => {
  it("AND group: all true -> true", () => {
    const group: EvaluationGroup = {
      logicOperator: "AND",
      conditions: [
        fieldCondition({ sourceFieldKey: "a", operator: "EQUALS", comparisonValue: "1" }),
        fieldCondition({ sourceFieldKey: "b", operator: "EQUALS", comparisonValue: "2" }),
      ],
      childGroups: [],
    }
    const r = evaluateGroup(group, ctx({ fieldValues: { a: "1", b: "2" } }))
    expect(r.result).toBe(true)
  })

  it("AND group: one false -> false", () => {
    const group: EvaluationGroup = {
      logicOperator: "AND",
      conditions: [
        fieldCondition({ sourceFieldKey: "a", operator: "EQUALS", comparisonValue: "1" }),
        fieldCondition({ sourceFieldKey: "b", operator: "EQUALS", comparisonValue: "2" }),
      ],
      childGroups: [],
    }
    const r = evaluateGroup(group, ctx({ fieldValues: { a: "1", b: "WRONG" } }))
    expect(r.result).toBe(false)
  })

  it("OR group: one true -> true", () => {
    const group: EvaluationGroup = {
      logicOperator: "OR",
      conditions: [
        fieldCondition({ sourceFieldKey: "a", operator: "EQUALS", comparisonValue: "1" }),
        fieldCondition({ sourceFieldKey: "b", operator: "EQUALS", comparisonValue: "2" }),
      ],
      childGroups: [],
    }
    const r = evaluateGroup(group, ctx({ fieldValues: { a: "WRONG", b: "2" } }))
    expect(r.result).toBe(true)
  })

  it("OR group: all false -> false", () => {
    const group: EvaluationGroup = {
      logicOperator: "OR",
      conditions: [
        fieldCondition({ sourceFieldKey: "a", operator: "EQUALS", comparisonValue: "1" }),
        fieldCondition({ sourceFieldKey: "b", operator: "EQUALS", comparisonValue: "2" }),
      ],
      childGroups: [],
    }
    const r = evaluateGroup(group, ctx({ fieldValues: { a: "x", b: "y" } }))
    expect(r.result).toBe(false)
  })

  it("one nested subgroup: AND(leaf, OR(leaf, leaf))", () => {
    const group: EvaluationGroup = {
      logicOperator: "AND",
      conditions: [fieldCondition({ sourceFieldKey: "top", operator: "EQUALS", comparisonValue: "yes" })],
      childGroups: [
        {
          logicOperator: "OR",
          conditions: [
            fieldCondition({ sourceFieldKey: "sub1", operator: "EQUALS", comparisonValue: "a" }),
            fieldCondition({ sourceFieldKey: "sub2", operator: "EQUALS", comparisonValue: "b" }),
          ],
          childGroups: [],
        },
      ],
    }
    // top true, subgroup: sub1 wrong but sub2 matches -> subgroup true -> AND true
    const r1 = evaluateGroup(group, ctx({ fieldValues: { top: "yes", sub1: "no", sub2: "b" } }))
    expect(r1.result).toBe(true)

    // top true, subgroup both wrong -> subgroup false -> AND false
    const r2 = evaluateGroup(group, ctx({ fieldValues: { top: "yes", sub1: "no", sub2: "no" } }))
    expect(r2.result).toBe(false)
  })

  it("empty group (no conditions, no subgroups) evaluates vacuously true", () => {
    const group: EvaluationGroup = { logicOperator: "AND", conditions: [], childGroups: [] }
    const r = evaluateGroup(group, ctx())
    expect(r.result).toBe(true)
  })

  it("short-circuit-equivalent correctness: AND stops mattering after first false regardless of order", () => {
    const group: EvaluationGroup = {
      logicOperator: "AND",
      conditions: [
        fieldCondition({ sourceFieldKey: "a", operator: "EQUALS", comparisonValue: "nope" }),
        fieldCondition({ sourceFieldKey: "b", operator: "EQUALS", comparisonValue: "2" }),
      ],
      childGroups: [],
    }
    const r = evaluateGroup(group, ctx({ fieldValues: { a: "no-match", b: "2" } }))
    expect(r.result).toBe(false)
    // Detail still reports both — full detail is preserved for preview/debugging even though AND already failed.
    expect(r.conditions).toHaveLength(2)
  })
})

describe("evaluateConditionTree — no-condition default", () => {
  it("returns true when group is null (caller applies its own default on top)", () => {
    const r = evaluateConditionTree(null, ctx())
    expect(r.result).toBe(true)
    expect(r.detail.conditions).toHaveLength(0)
  })

  it("delegates to evaluateGroup when a group is present", () => {
    const group: EvaluationGroup = { logicOperator: "AND", conditions: [fieldCondition({ operator: "EQUALS", comparisonValue: "active" })], childGroups: [] }
    const r = evaluateConditionTree(group, ctx({ fieldValues: { status: "active" } }))
    expect(r.result).toBe(true)
  })
})

describe("operator-compatibility — resolveCompatibilityKind / isOperatorCompatible", () => {
  it("resolves TEMPLATE_FIELD kinds from fieldType", () => {
    expect(resolveCompatibilityKind("TEMPLATE_FIELD", "checkbox")).toBe("checkbox")
    expect(resolveCompatibilityKind("TEMPLATE_FIELD", "select")).toBe("select")
  })

  it("returns null for an unrecognized fieldType", () => {
    expect(resolveCompatibilityKind("TEMPLATE_FIELD", "not-a-real-type")).toBeNull()
  })

  it("resolves pseudo-field kinds", () => {
    expect(resolveCompatibilityKind("CLIENT_IS_MINOR")).toBe("boolean")
    expect(resolveCompatibilityKind("PACKET_PROGRAM_CODE")).toBe("select")
    expect(resolveCompatibilityKind("PACKET_TYPE")).toBe("select")
  })

  it.each([
    ["EQUALS", "text", true], ["EQUALS", "signature", false],
    ["CONTAINS", "textarea", true], ["CONTAINS", "checkbox", false],
    ["NOT_EMPTY", "signature", true],
    ["CHECKED", "checkbox", true], ["CHECKED", "select", false],
    ["BEFORE", "date", true], ["BEFORE", "text", false],
    ["GREATER_THAN", "text", true], ["GREATER_THAN", "checkbox", false],
    ["IN", "select", true], ["IN", "boolean", false],
  ] as const)("%s + %s compatible=%s", (operator, kind, expected) => {
    expect(isOperatorCompatible(operator, kind)).toBe(expected)
  })
})

describe("operator-compatibility — validateComparisonValueShape", () => {
  it.each(["CHECKED", "UNCHECKED", "EMPTY", "NOT_EMPTY"] as const)("%s rejects a present comparisonValue", (operator) => {
    expect(validateComparisonValueShape(operator, "something").valid).toBe(false)
  })

  it.each(["CHECKED", "UNCHECKED", "EMPTY", "NOT_EMPTY"] as const)("%s accepts an absent comparisonValue", (operator) => {
    expect(validateComparisonValueShape(operator, undefined).valid).toBe(true)
  })

  it.each(["IN", "NOT_IN"] as const)("%s requires a non-empty array", (operator) => {
    expect(validateComparisonValueShape(operator, []).valid).toBe(false)
    expect(validateComparisonValueShape(operator, "not-an-array").valid).toBe(false)
    expect(validateComparisonValueShape(operator, ["a"]).valid).toBe(true)
  })

  it("EQUALS requires a present comparisonValue", () => {
    expect(validateComparisonValueShape("EQUALS", undefined).valid).toBe(false)
    expect(validateComparisonValueShape("EQUALS", "").valid).toBe(false)
    expect(validateComparisonValueShape("EQUALS", "x").valid).toBe(true)
  })

  it("BEFORE/AFTER require a valid date string", () => {
    expect(validateComparisonValueShape("BEFORE", "not-a-date").valid).toBe(false)
    expect(validateComparisonValueShape("BEFORE", "2025-01-01").valid).toBe(true)
  })

  it("GREATER_THAN/LESS_THAN require numeric or date", () => {
    expect(validateComparisonValueShape("GREATER_THAN", "abc").valid).toBe(false)
    expect(validateComparisonValueShape("GREATER_THAN", "42").valid).toBe(true)
    expect(validateComparisonValueShape("LESS_THAN", "2025-01-01").valid).toBe(true)
  })
})
