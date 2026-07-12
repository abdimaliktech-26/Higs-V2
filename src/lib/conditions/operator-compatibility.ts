// Stage 5 Step 4a: Conditional Logic Foundation — operator/type compatibility
// and comparisonValue shape validation. Pure, no Prisma. Enforced at
// condition-save time (see src/lib/actions/template-conditions.ts) so a
// broken operator/type/comparisonValue combination can never be persisted.
import type { ConditionOperator, ConditionSourceType, TemplateFieldType } from "./types"

export const TEMPLATE_FIELD_TYPES: TemplateFieldType[] = ["text", "date", "checkbox", "signature", "textarea", "select"]

// A pseudo-field's "kind" for compatibility purposes — CLIENT_IS_MINOR
// behaves like a checkbox (boolean), PACKET_PROGRAM_CODE/PACKET_TYPE behave
// like a select (fixed string domain).
export type CompatibilityKind = TemplateFieldType | "boolean"

const PSEUDO_FIELD_KIND: Record<Exclude<ConditionSourceType, "TEMPLATE_FIELD">, CompatibilityKind> = {
  CLIENT_IS_MINOR: "boolean",
  PACKET_PROGRAM_CODE: "select",
  PACKET_TYPE: "select",
}

const OPERATOR_COMPATIBILITY: Record<ConditionOperator, CompatibilityKind[]> = {
  EQUALS: ["text", "date", "checkbox", "select", "boolean"],
  NOT_EQUALS: ["text", "date", "checkbox", "select", "boolean"],
  CONTAINS: ["text", "textarea"],
  NOT_EMPTY: ["text", "date", "checkbox", "textarea", "signature", "select"],
  EMPTY: ["text", "date", "checkbox", "textarea", "signature", "select"],
  CHECKED: ["checkbox"],
  UNCHECKED: ["checkbox"],
  GREATER_THAN: ["date", "text"],
  LESS_THAN: ["date", "text"],
  BEFORE: ["date"],
  AFTER: ["date"],
  IN: ["select"],
  NOT_IN: ["select"],
}

/**
 * Resolves what "kind" a condition's source resolves to for compatibility
 * checking. For TEMPLATE_FIELD, pass the referenced DocumentTemplateField's
 * actual fieldType; returns null if that fieldType isn't recognized at all
 * (defense in depth — should never happen since fieldType is itself
 * constrained by TEMPLATE_FIELD_TYPES elsewhere).
 */
export function resolveCompatibilityKind(sourceType: ConditionSourceType, fieldType?: string | null): CompatibilityKind | null {
  if (sourceType === "TEMPLATE_FIELD") {
    if (!fieldType) return null
    return (TEMPLATE_FIELD_TYPES as string[]).includes(fieldType) ? (fieldType as TemplateFieldType) : null
  }
  return PSEUDO_FIELD_KIND[sourceType]
}

export function isOperatorCompatible(operator: ConditionOperator, kind: CompatibilityKind): boolean {
  return OPERATOR_COMPATIBILITY[operator]?.includes(kind) ?? false
}

export type ComparisonValueValidation = { valid: true } | { valid: false; error: string }

const OPERATORS_REQUIRING_ABSENT_VALUE: ConditionOperator[] = ["CHECKED", "UNCHECKED", "EMPTY", "NOT_EMPTY"]
const OPERATORS_REQUIRING_ARRAY_VALUE: ConditionOperator[] = ["IN", "NOT_IN"]
const OPERATORS_REQUIRING_NUMERIC_OR_DATE: ConditionOperator[] = ["GREATER_THAN", "LESS_THAN"]
const OPERATORS_REQUIRING_DATE: ConditionOperator[] = ["BEFORE", "AFTER"]

function isParsableNumber(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value)
  if (typeof value === "string" && value.trim() !== "") return !Number.isNaN(Number(value))
  return false
}

function isParsableDate(value: unknown): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false
  return !Number.isNaN(Date.parse(String(value)))
}

/** Validates comparisonValue's *shape* for a given operator — independent of field type. */
export function validateComparisonValueShape(operator: ConditionOperator, comparisonValue: unknown): ComparisonValueValidation {
  if (OPERATORS_REQUIRING_ABSENT_VALUE.includes(operator)) {
    if (comparisonValue !== undefined && comparisonValue !== null) {
      return { valid: false, error: `${operator} must not include a comparison value` }
    }
    return { valid: true }
  }

  if (OPERATORS_REQUIRING_ARRAY_VALUE.includes(operator)) {
    if (!Array.isArray(comparisonValue) || comparisonValue.length === 0) {
      return { valid: false, error: `${operator} requires a non-empty array of comparison values` }
    }
    return { valid: true }
  }

  if (comparisonValue === undefined || comparisonValue === null || comparisonValue === "") {
    return { valid: false, error: `${operator} requires a comparison value` }
  }

  if (OPERATORS_REQUIRING_NUMERIC_OR_DATE.includes(operator)) {
    if (!isParsableNumber(comparisonValue) && !isParsableDate(comparisonValue)) {
      return { valid: false, error: `${operator} requires a numeric or date comparison value` }
    }
    return { valid: true }
  }

  if (OPERATORS_REQUIRING_DATE.includes(operator)) {
    if (!isParsableDate(comparisonValue)) {
      return { valid: false, error: `${operator} requires a valid date comparison value` }
    }
    return { valid: true }
  }

  return { valid: true }
}
