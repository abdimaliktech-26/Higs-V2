// Stage 5 Step 4c.3c.1 — pure, presentational metric definitions for the PDF
// editor. Mirrors the project's existing pattern of extracting derived-value
// formulas into a dedicated, independently testable module (see
// executive-metrics.ts, di-metrics.ts, packet-overview-metrics.ts). Every
// function here is a pure transform over already-authoritative DTO fields
// returned by getEditableDocument (Steps 4c.3a/4c.3b) — nothing here
// evaluates conditions itself; that stays server-side until Step 4c.3c.2.

export interface EditorField {
  id: string
  value: string | null
  isVisible: boolean
  effectiveRequired: boolean
  requirednessConditionPresent?: boolean
  fieldType?: string | null
}

// Mirrors the client's own long-standing truthiness rule for "has this field
// been answered" — an empty or whitespace-only string does not count.
export function fieldHasMeaningfulValue(value: string | null | undefined): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value)
}

export function computeVisibleFields<T extends { isVisible: boolean }>(fields: T[]): T[] {
  return fields.filter((f) => f.isVisible)
}

// Zero visible fields is defined as fully complete (100%) — there is
// nothing left to answer, not "nothing has been answered."
export function computeCompletionPercent(visibleFields: { value: string | null }[]): number {
  if (visibleFields.length === 0) return 100
  const completed = visibleFields.filter((f) => fieldHasMeaningfulValue(f.value)).length
  return Math.round((completed / visibleFields.length) * 100)
}

export function computeMissingRequired<T extends { effectiveRequired: boolean; value: string | null }>(visibleFields: T[]): T[] {
  return visibleFields.filter((f) => f.effectiveRequired && !fieldHasMeaningfulValue(f.value))
}

export function computeWarningFields<T extends { effectiveRequired: boolean; value: string | null }>(visibleFields: T[]): T[] {
  return visibleFields.filter((f) => !f.effectiveRequired && !fieldHasMeaningfulValue(f.value))
}

export function signatureType(type: string | null | undefined): boolean {
  const value = (type || "").toLowerCase()
  return value.includes("signature") || value.includes("initial")
}

export function computeSignatureFields<T extends { fieldType?: string | null }>(visibleFields: T[]): T[] {
  return visibleFields.filter((f) => signatureType(f.fieldType))
}

export type RequiredMarkerKind = "static" | "conditional" | "none"

// A field only ever shows a required marker when it is currently required —
// hidden fields are never passed here at all (they're excluded from
// rendering upstream), and a currently-optional field shows nothing.
// `requirednessConditionPresent` distinguishes "required because a
// condition currently resolves that way" from "required unconditionally" —
// legacy fields always report it false, so their marker is always "static",
// preserving today's look exactly.
export function getRequiredMarkerKind(field: { effectiveRequired: boolean; requirednessConditionPresent?: boolean }): RequiredMarkerKind {
  if (!field.effectiveRequired) return "none"
  return field.requirednessConditionPresent ? "conditional" : "static"
}

export type ReadOnlyBannerKind = "configuration_error" | "inactive" | "approval_locked" | "role_locked"

export interface ReadOnlyBannerInfo {
  kind: ReadOnlyBannerKind
  message: string
  role: "alert" | "status"
}

const DEFAULT_MESSAGES: Record<ReadOnlyBannerKind, string> = {
  configuration_error: "This document has a compliance configuration error and cannot be edited until it is resolved.",
  inactive: "This document is currently not applicable based on packet conditions.",
  approval_locked: "This document is approved and locked for editing.",
  role_locked: "Your role has view-only access to this document.",
}

// Priority mirrors the server's own readOnlyReason derivation exactly
// (getEditableDocument in documents.ts) — a configuration error is the most
// actionable/urgent, then inactivity, then the approval lock, then a plain
// role-based restriction. Only ever one banner renders; the server's own
// safe, pre-vetted message text is used verbatim rather than re-derived
// client-side, so no internal condition detail can ever leak through here.
export function determineReadOnlyBanner(doc: {
  conditionConfigurationError?: boolean
  applicabilityStatus?: string | null
  isLockedByApproval?: boolean
  isReadOnly?: boolean
  readOnlyReason?: string | null
}): ReadOnlyBannerInfo | null {
  if (doc.conditionConfigurationError) {
    return { kind: "configuration_error", message: doc.readOnlyReason || DEFAULT_MESSAGES.configuration_error, role: "alert" }
  }
  if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
    return { kind: "inactive", message: doc.readOnlyReason || DEFAULT_MESSAGES.inactive, role: "status" }
  }
  if (doc.isLockedByApproval) {
    return { kind: "approval_locked", message: doc.readOnlyReason || DEFAULT_MESSAGES.approval_locked, role: "status" }
  }
  if (doc.isReadOnly) {
    return { kind: "role_locked", message: doc.readOnlyReason || DEFAULT_MESSAGES.role_locked, role: "status" }
  }
  return null
}

// Ids only, never names/values (matches the server's own no-PHI response
// shape from Step 4c.3b) — the notice is a count, nothing more.
export function ignoredFieldsNoticeText(ignoredFieldIds: unknown): string | null {
  if (!Array.isArray(ignoredFieldIds) || ignoredFieldIds.length === 0) return null
  const count = ignoredFieldIds.length
  return `${count} field${count === 1 ? "" : "s"} ${count === 1 ? "was" : "were"} not saved because ${count === 1 ? "it is" : "they are"} currently hidden.`
}
