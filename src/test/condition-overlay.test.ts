// Stage 5 Step 4c.3c.2 — pure tests for the optimistic condition overlay
// merge/diff helpers.
import { describe, it, expect } from "vitest"
import { mergeFieldWithOverlay, mergeFieldsWithOverlay, diffOverlayForAnnouncements } from "@/app/documents/[id]/edit/condition-overlay"

function field(overrides: Record<string, unknown> = {}) {
  return { id: "f1", name: "Field One", isVisible: true, effectiveRequired: false, conditionallyRequired: false, ...overrides }
}

describe("mergeFieldWithOverlay", () => {
  it("returns the base field unchanged when no overlay entry exists", () => {
    const f = field()
    expect(mergeFieldWithOverlay(f, {})).toBe(f)
  })
  it("overrides isVisible/effectiveRequired/conditionallyRequired when an overlay entry exists", () => {
    const f = field({ isVisible: true, effectiveRequired: false })
    const merged = mergeFieldWithOverlay(f, { f1: { isVisible: false, effectiveRequired: true, conditionallyRequired: true } })
    expect(merged.isVisible).toBe(false)
    expect(merged.effectiveRequired).toBe(true)
    expect(merged.conditionallyRequired).toBe(true)
  })
  it("never changes any other property (name, value, etc.)", () => {
    const f = field({ name: "Untouched", value: "kept" } as any)
    const merged = mergeFieldWithOverlay(f, { f1: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } })
    expect((merged as any).name).toBe("Untouched")
    expect((merged as any).value).toBe("kept")
  })
})

describe("mergeFieldsWithOverlay", () => {
  it("merges each field independently", () => {
    const fields = [field({ id: "a" }), field({ id: "b" })]
    const merged = mergeFieldsWithOverlay(fields, { b: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } })
    expect(merged[0].isVisible).toBe(true)
    expect(merged[1].isVisible).toBe(false)
  })
})

describe("diffOverlayForAnnouncements", () => {
  it("produces no messages and no hidden ids when nothing changed", () => {
    const fields = [field()]
    const result = diffOverlayForAnnouncements(fields, {}, {})
    expect(result.messages).toEqual([])
    expect(result.newlyHiddenFieldIds).toEqual([])
  })

  it("announces a field becoming hidden and lists it as newly hidden", () => {
    const fields = [field({ id: "f1", name: "Guardian Name", isVisible: true })]
    const result = diffOverlayForAnnouncements(fields, {}, { f1: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } })
    expect(result.messages).toEqual(["Guardian Name is no longer applicable."])
    expect(result.newlyHiddenFieldIds).toEqual(["f1"])
  })

  it("announces a field becoming visible again, without listing it as newly hidden", () => {
    const fields = [field({ id: "f1", name: "Guardian Name", isVisible: false })]
    const prevOverlay = { f1: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } }
    const result = diffOverlayForAnnouncements(fields, prevOverlay, { f1: { isVisible: true, effectiveRequired: false, conditionallyRequired: false } })
    expect(result.messages).toEqual(["Guardian Name is now available."])
    expect(result.newlyHiddenFieldIds).toEqual([])
  })

  it("announces a visible field becoming required", () => {
    const fields = [field({ id: "f1", name: "Guardian Signature", isVisible: true, effectiveRequired: false })]
    const result = diffOverlayForAnnouncements(fields, {}, { f1: { isVisible: true, effectiveRequired: true, conditionallyRequired: true } })
    expect(result.messages).toEqual(["Guardian Signature is now required."])
  })

  it("announces a visible field becoming optional", () => {
    const fields = [field({ id: "f1", name: "Guardian Signature", isVisible: true, effectiveRequired: true })]
    const prevOverlay = { f1: { isVisible: true, effectiveRequired: true, conditionallyRequired: true } }
    const result = diffOverlayForAnnouncements(fields, prevOverlay, { f1: { isVisible: true, effectiveRequired: false, conditionallyRequired: false } })
    expect(result.messages).toEqual(["Guardian Signature is now optional."])
  })

  it("never announces a requiredness change for a field that is hidden both before and after", () => {
    const fields = [field({ id: "f1", name: "Hidden Field", isVisible: false, effectiveRequired: false })]
    const prevOverlay = { f1: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } }
    const result = diffOverlayForAnnouncements(fields, prevOverlay, { f1: { isVisible: false, effectiveRequired: true, conditionallyRequired: true } })
    expect(result.messages).toEqual([])
  })

  it("collects messages for multiple simultaneously-changed fields in one pass", () => {
    const fields = [
      field({ id: "f1", name: "Guardian Name", isVisible: true }),
      field({ id: "f2", name: "Guardian Signature", isVisible: true, effectiveRequired: false }),
    ]
    const result = diffOverlayForAnnouncements(fields, {}, {
      f1: { isVisible: false, effectiveRequired: false, conditionallyRequired: false },
      f2: { isVisible: true, effectiveRequired: true, conditionallyRequired: true },
    })
    expect(result.messages).toEqual(["Guardian Name is no longer applicable.", "Guardian Signature is now required."])
    expect(result.newlyHiddenFieldIds).toEqual(["f1"])
  })

  it("treats a field absent from the new overlay as falling back to its base DTO value, not as unchanged from the previous overlay", () => {
    // If a field was hidden via a previous evaluation but the newest
    // response doesn't mention it, it means the newest evaluation
    // considers it at its base DTO state, not "still hidden."
    const fields = [field({ id: "f1", name: "Guardian Name", isVisible: true })] // base DTO says visible
    const prevOverlay = { f1: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } }
    const result = diffOverlayForAnnouncements(fields, prevOverlay, {})
    expect(result.messages).toEqual(["Guardian Name is now available."])
  })
})
