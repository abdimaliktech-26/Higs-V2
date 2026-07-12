// Stage 5 Step 4a: Conditional Logic Foundation — pure evaluator.
//
// Deliberately framework-independent: no Prisma import, no cookies/session
// read, no network call, no mutation of its inputs. Runs identically on the
// server (authoritative) and in the browser (instant preview only) — the
// caller decides which context it's running in; this module has no opinion.
//
// Deterministic rules (see docs/UI_CORRECTION_STATUS.md for the approved
// policy this implements):
//   - missing/undefined/null/blank-string field values evaluate as "empty"
//   - a genuinely malformed comparison (e.g. an unparseable date/number)
//     evaluates false, never throws
//   - no condition group at all means "true" — the caller applies its own
//     default (visible, or the field's static isRequired) on top of that
import type {
  ConditionEvaluationDetail,
  ConditionOperator,
  EvaluationCondition,
  EvaluationContext,
  EvaluationGroup,
  EvaluationResult,
  GroupEvaluationDetail,
} from "./types"

// Operators whose result is "true" when the resolved value is empty/missing —
// mirrors "not equal to X" / "not in the list" / "unchecked" all being
// naturally satisfied by the absence of a value. Every other operator is
// "false" when the resolved value is empty/missing.
const NEGATIVE_ON_EMPTY: ReadonlySet<ConditionOperator> = new Set(["NOT_EQUALS", "UNCHECKED", "NOT_IN", "EMPTY"])

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null) return true
  if (typeof value === "string" && value.trim() === "") return true
  return false
}

function isTruthyCheckbox(value: unknown): boolean {
  if (value === true) return true
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase()
    return normalized === "true" || normalized === "on" || normalized === "yes" || normalized === "1" || normalized === "checked"
  }
  if (typeof value === "number") return value === 1
  return false
}

function normalizeForEquality(value: unknown): string {
  if (value === null || value === undefined) return ""
  if (value instanceof Date) return value.toISOString()
  return String(value).trim().toLowerCase()
}

function toComparableNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value)
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function toComparableDate(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime()
  if (typeof value === "string" || typeof value === "number") {
    const parsed = Date.parse(String(value))
    return Number.isNaN(parsed) ? null : parsed
  }
  return null
}

function resolveSourceValue(condition: EvaluationCondition, context: EvaluationContext): unknown {
  switch (condition.sourceType) {
    case "TEMPLATE_FIELD":
      if (!condition.sourceFieldKey) return undefined
      return context.fieldValues[condition.sourceFieldKey]
    case "CLIENT_IS_MINOR":
      return context.client.isMinor
    case "PACKET_PROGRAM_CODE":
      return context.packet.programCode
    case "PACKET_TYPE":
      return context.packet.packetType
    default:
      return undefined
  }
}

function evaluateOperator(operator: ConditionOperator, resolvedValue: unknown, comparisonValue: unknown): boolean {
  // CHECKED/UNCHECKED read the resolved value's truthiness directly — no
  // "empty" short-circuit needed since isTruthyCheckbox already treats a
  // missing/blank value as not-checked.
  if (operator === "CHECKED") return isTruthyCheckbox(resolvedValue)
  if (operator === "UNCHECKED") return !isTruthyCheckbox(resolvedValue)
  if (operator === "EMPTY") return isEmptyValue(resolvedValue)
  if (operator === "NOT_EMPTY") return !isEmptyValue(resolvedValue)

  if (isEmptyValue(resolvedValue)) return NEGATIVE_ON_EMPTY.has(operator)

  switch (operator) {
    case "EQUALS":
      return normalizeForEquality(resolvedValue) === normalizeForEquality(comparisonValue)
    case "NOT_EQUALS":
      return normalizeForEquality(resolvedValue) !== normalizeForEquality(comparisonValue)
    case "CONTAINS":
      return normalizeForEquality(resolvedValue).includes(normalizeForEquality(comparisonValue))
    case "IN": {
      if (!Array.isArray(comparisonValue)) return false
      const normalized = normalizeForEquality(resolvedValue)
      return comparisonValue.some((v) => normalizeForEquality(v) === normalized)
    }
    case "NOT_IN": {
      if (!Array.isArray(comparisonValue)) return true
      const normalized = normalizeForEquality(resolvedValue)
      return !comparisonValue.some((v) => normalizeForEquality(v) === normalized)
    }
    case "GREATER_THAN":
    case "LESS_THAN": {
      const resolvedNum = toComparableNumber(resolvedValue)
      const comparisonNum = toComparableNumber(comparisonValue)
      if (resolvedNum !== null && comparisonNum !== null) {
        return operator === "GREATER_THAN" ? resolvedNum > comparisonNum : resolvedNum < comparisonNum
      }
      const resolvedDate = toComparableDate(resolvedValue)
      const comparisonDate = toComparableDate(comparisonValue)
      if (resolvedDate !== null && comparisonDate !== null) {
        return operator === "GREATER_THAN" ? resolvedDate > comparisonDate : resolvedDate < comparisonDate
      }
      return false // malformed — never throws
    }
    case "BEFORE":
    case "AFTER": {
      const resolvedDate = toComparableDate(resolvedValue)
      const comparisonDate = toComparableDate(comparisonValue)
      if (resolvedDate === null || comparisonDate === null) return false // malformed — never throws
      return operator === "BEFORE" ? resolvedDate < comparisonDate : resolvedDate > comparisonDate
    }
    default:
      return false
  }
}

export function evaluateCondition(condition: EvaluationCondition, context: EvaluationContext): ConditionEvaluationDetail {
  const resolvedValue = resolveSourceValue(condition, context)
  const result = evaluateOperator(condition.operator, resolvedValue, condition.comparisonValue)
  return {
    sourceType: condition.sourceType,
    sourceFieldKey: condition.sourceFieldKey,
    operator: condition.operator,
    resolvedValue,
    comparisonValue: condition.comparisonValue,
    result,
  }
}

export function evaluateGroup(group: EvaluationGroup, context: EvaluationContext): GroupEvaluationDetail {
  const conditionDetails = group.conditions.map((c) => evaluateCondition(c, context))
  const childDetails = group.childGroups.map((g) => evaluateGroup(g, context))
  const allResults = [...conditionDetails.map((d) => d.result), ...childDetails.map((d) => d.result)]

  // An empty group (no conditions, no subgroups) is a data-integrity problem
  // flagged by validateTemplateConditions, not something the evaluator
  // should silently decide either way for — treat as vacuously true so it
  // never blocks something that should otherwise be visible/required.
  const result = allResults.length === 0 ? true : group.logicOperator === "AND" ? allResults.every(Boolean) : allResults.some(Boolean)

  return { logicOperator: group.logicOperator, result, conditions: conditionDetails, childGroups: childDetails }
}

/**
 * Top-level entry point. `group` is null when a field/document has no
 * condition attached at all — the evaluator reports `true` in that case, and
 * the caller (not built in this step) decides what "true" means for its own
 * default (e.g. "visible" or "use the static isRequired flag").
 */
export function evaluateConditionTree(group: EvaluationGroup | null, context: EvaluationContext): EvaluationResult {
  if (!group) {
    return { result: true, detail: { logicOperator: "AND", result: true, conditions: [], childGroups: [] } }
  }
  const detail = evaluateGroup(group, context)
  return { result: detail.result, detail }
}
