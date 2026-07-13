// Stage 5 Step 4c.3c.1 — pure metric/formula tests for the PDF editor's
// visibility filtering, condition-aware requiredness markers, completion
// math, and read-only banner priority.
import { describe, it, expect } from "vitest"
import {
  fieldHasMeaningfulValue,
  computeVisibleFields,
  computeCompletionPercent,
  computeMissingRequired,
  computeWarningFields,
  signatureType,
  computeSignatureFields,
  getRequiredMarkerKind,
  determineReadOnlyBanner,
  ignoredFieldsNoticeText,
} from "@/app/documents/[id]/edit/editor-metrics"

describe("fieldHasMeaningfulValue", () => {
  it("treats null/undefined as no value", () => {
    expect(fieldHasMeaningfulValue(null)).toBe(false)
    expect(fieldHasMeaningfulValue(undefined)).toBe(false)
  })
  it("treats empty and whitespace-only strings as no value", () => {
    expect(fieldHasMeaningfulValue("")).toBe(false)
    expect(fieldHasMeaningfulValue("   ")).toBe(false)
  })
  it("treats a real string as a value", () => {
    expect(fieldHasMeaningfulValue("answer")).toBe(true)
  })
})

describe("computeVisibleFields", () => {
  it("filters out fields with isVisible:false", () => {
    const fields = [{ isVisible: true, id: "a" }, { isVisible: false, id: "b" }, { isVisible: true, id: "c" }]
    expect(computeVisibleFields(fields).map((f) => f.id)).toEqual(["a", "c"])
  })
})

describe("computeCompletionPercent", () => {
  it("returns 100 when there are zero visible fields", () => {
    expect(computeCompletionPercent([])).toBe(100)
  })
  it("computes percentage from visible fields only", () => {
    expect(computeCompletionPercent([{ value: "x" }, { value: null }])).toBe(50)
  })
  it("a hidden required field never reduces completion (proven by exclusion before this call)", () => {
    // computeCompletionPercent only ever receives already-visible fields —
    // the exclusion happens at computeVisibleFields, not here.
    expect(computeCompletionPercent([{ value: "x" }])).toBe(100)
  })
})

describe("computeMissingRequired", () => {
  it("counts a visible, effectively-required, empty field as missing", () => {
    const result = computeMissingRequired([{ effectiveRequired: true, value: null }])
    expect(result).toHaveLength(1)
  })
  it("does not count a conditionally-optional empty field as missing", () => {
    const result = computeMissingRequired([{ effectiveRequired: false, value: null }])
    expect(result).toHaveLength(0)
  })
  it("does not count a filled required field as missing", () => {
    const result = computeMissingRequired([{ effectiveRequired: true, value: "answer" }])
    expect(result).toHaveLength(0)
  })
})

describe("computeWarningFields", () => {
  it("counts a visible, optional, empty field as a warning", () => {
    expect(computeWarningFields([{ effectiveRequired: false, value: null }])).toHaveLength(1)
  })
  it("does not count a required empty field as a warning (it's missing, not a warning)", () => {
    expect(computeWarningFields([{ effectiveRequired: true, value: null }])).toHaveLength(0)
  })
})

describe("signatureType / computeSignatureFields", () => {
  it("matches signature and initials field types", () => {
    expect(signatureType("signature")).toBe(true)
    expect(signatureType("initials")).toBe(true)
    expect(signatureType("text")).toBe(false)
    expect(signatureType(null)).toBe(false)
  })
  it("excludes a hidden signature field (already filtered before this call)", () => {
    const visible = computeVisibleFields([{ isVisible: false, fieldType: "signature" }])
    expect(computeSignatureFields(visible)).toHaveLength(0)
  })
})

describe("getRequiredMarkerKind", () => {
  it("returns none for a currently-optional field", () => {
    expect(getRequiredMarkerKind({ effectiveRequired: false })).toBe("none")
  })
  it("returns static for a required field with no requiredness condition (legacy shape)", () => {
    expect(getRequiredMarkerKind({ effectiveRequired: true, requirednessConditionPresent: false })).toBe("static")
  })
  it("returns static when requirednessConditionPresent is omitted entirely", () => {
    expect(getRequiredMarkerKind({ effectiveRequired: true })).toBe("static")
  })
  it("returns conditional for a required field whose requiredness comes from a condition", () => {
    expect(getRequiredMarkerKind({ effectiveRequired: true, requirednessConditionPresent: true })).toBe("conditional")
  })
})

describe("determineReadOnlyBanner", () => {
  it("returns null when nothing is read-only", () => {
    expect(determineReadOnlyBanner({})).toBeNull()
  })

  it("configuration error takes priority over every other read-only state", () => {
    const info = determineReadOnlyBanner({
      conditionConfigurationError: true,
      applicabilityStatus: "CONDITIONALLY_INACTIVE",
      isLockedByApproval: true,
      isReadOnly: true,
      readOnlyReason: "This document has a compliance configuration error and cannot be edited until it is resolved.",
    })
    expect(info?.kind).toBe("configuration_error")
    expect(info?.role).toBe("alert")
  })

  it("inactive takes priority over approval lock and role-based read-only", () => {
    const info = determineReadOnlyBanner({
      applicabilityStatus: "CONDITIONALLY_INACTIVE",
      isLockedByApproval: true,
      isReadOnly: true,
      readOnlyReason: "This document is currently not applicable based on packet conditions.",
    })
    expect(info?.kind).toBe("inactive")
    expect(info?.role).toBe("status")
  })

  it("approval lock takes priority over plain role-based read-only", () => {
    const info = determineReadOnlyBanner({
      isLockedByApproval: true,
      isReadOnly: true,
      readOnlyReason: "This document is approved and locked for editing.",
    })
    expect(info?.kind).toBe("approval_locked")
    expect(info?.role).toBe("status")
  })

  it("falls back to role-based read-only when nothing more specific applies", () => {
    const info = determineReadOnlyBanner({ isReadOnly: true, readOnlyReason: "Your role has view-only access to this document." })
    expect(info?.kind).toBe("role_locked")
    expect(info?.role).toBe("status")
  })

  it("uses the server-provided readOnlyReason verbatim rather than a re-derived message", () => {
    const info = determineReadOnlyBanner({ isLockedByApproval: true, readOnlyReason: "custom server text" })
    expect(info?.message).toBe("custom server text")
  })

  it("falls back to a safe default message if readOnlyReason is missing", () => {
    const info = determineReadOnlyBanner({ isLockedByApproval: true })
    expect(info?.message).toBe("This document is approved and locked for editing.")
  })
})

describe("ignoredFieldsNoticeText", () => {
  it("returns null for an empty array", () => {
    expect(ignoredFieldsNoticeText([])).toBeNull()
  })
  it("returns null for a non-array value", () => {
    expect(ignoredFieldsNoticeText(undefined)).toBeNull()
  })
  it("singularizes correctly for exactly one ignored field", () => {
    expect(ignoredFieldsNoticeText(["f1"])).toBe("1 field was not saved because it is currently hidden.")
  })
  it("pluralizes correctly for multiple ignored fields", () => {
    expect(ignoredFieldsNoticeText(["f1", "f2"])).toBe("2 fields were not saved because they are currently hidden.")
  })
  it("never includes field ids or names in the message text", () => {
    const text = ignoredFieldsNoticeText(["field-abc-123"])
    expect(text).not.toMatch(/field-abc-123/)
  })
})
