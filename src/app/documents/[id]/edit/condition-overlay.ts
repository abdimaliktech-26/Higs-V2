// Stage 5 Step 4c.3c.2 — pure helpers for the client-side optimistic
// condition overlay. The overlay itself only ever holds what
// evaluateDocumentFieldConditions returns (isVisible/effectiveRequired/
// conditionallyRequired per field id) — never condition trees, field keys,
// operators, or comparison values. These functions are pure so the
// merge/diff logic (which drives real-time hide/show, requiredness
// updates, and accessibility announcements) can be tested without
// rendering the full editor.

export interface ConditionOverlayView {
  isVisible: boolean
  effectiveRequired: boolean
  conditionallyRequired: boolean
}

export type ConditionOverlay = Record<string, ConditionOverlayView>

// The merged view a field should render with: the optimistic overlay's
// value when present, otherwise the server-loaded DTO value. Only these
// three properties are ever overridden — everything else on the field
// (name, value, templateFieldKey, requirednessConditionPresent, etc.)
// always comes from the base DTO field, since evaluation never changes it.
export function mergeFieldWithOverlay<T extends { id: string; isVisible: boolean; effectiveRequired: boolean; conditionallyRequired?: boolean }>(
  field: T,
  overlay: ConditionOverlay
): T {
  const view = overlay[field.id]
  if (!view) return field
  return { ...field, isVisible: view.isVisible, effectiveRequired: view.effectiveRequired, conditionallyRequired: view.conditionallyRequired }
}

export function mergeFieldsWithOverlay<T extends { id: string; isVisible: boolean; effectiveRequired: boolean; conditionallyRequired?: boolean }>(
  fields: T[],
  overlay: ConditionOverlay
): T[] {
  return fields.map((f) => mergeFieldWithOverlay(f, overlay))
}

export interface OverlayDiffResult {
  // Human-readable, deduplicated messages describing what changed for this
  // evaluation pass only — never the full document state, and never
  // anything beyond a field's display name and its visible/required
  // transition. Empty when nothing changed.
  messages: string[]
  // Field ids that were visible before this pass and are hidden now —
  // used to decide whether the currently-selected field needs to be
  // deselected. A field re-appearing is never included here.
  newlyHiddenFieldIds: string[]
}

// Compares each field's PREVIOUS effective view (previous overlay entry,
// or the base DTO value if this is the first evaluation pass) against its
// NEW effective view (new overlay entry, or the base DTO value if this
// evaluation didn't report anything for it) and produces the minimal set
// of announcements/hidden-field ids a single evaluation response should
// produce. Fields whose relevant state didn't change produce nothing.
export function diffOverlayForAnnouncements<T extends { id: string; name: string; isVisible: boolean; effectiveRequired: boolean }>(
  fields: T[],
  prevOverlay: ConditionOverlay,
  nextOverlay: ConditionOverlay
): OverlayDiffResult {
  const messages: string[] = []
  const newlyHiddenFieldIds: string[] = []

  for (const field of fields) {
    const before = prevOverlay[field.id] ?? { isVisible: field.isVisible, effectiveRequired: field.effectiveRequired, conditionallyRequired: false }
    const after = nextOverlay[field.id] ?? { isVisible: field.isVisible, effectiveRequired: field.effectiveRequired, conditionallyRequired: false }

    if (before.isVisible && !after.isVisible) {
      messages.push(`${field.name} is no longer applicable.`)
      newlyHiddenFieldIds.push(field.id)
    } else if (!before.isVisible && after.isVisible) {
      messages.push(`${field.name} is now available.`)
    } else if (before.isVisible && after.isVisible && before.effectiveRequired !== after.effectiveRequired) {
      messages.push(after.effectiveRequired ? `${field.name} is now required.` : `${field.name} is now optional.`)
    }
  }

  return { messages, newlyHiddenFieldIds }
}
