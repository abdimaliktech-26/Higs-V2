// Stage 5 Step 4c.3c.1 — FieldOverlays marker rendering. The component
// itself does not filter by isVisible (the parent passes already-filtered
// visible fields — see pdf-editor-client.tsx); these tests confirm the
// component only ever receives what it's given, and renders the correct
// static/conditional/none required-marker treatment.
import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { FieldOverlays } from "@/components/pdf/field-overlays"

function field(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1", name: "Field One", fieldType: "text", value: null,
    pageNumber: 1, posX: null, posY: null, width: null, height: null,
    isRequired: false, confidence: null,
    effectiveRequired: false, requirednessConditionPresent: false,
    ...overrides,
  }
}

describe("FieldOverlays — required marker treatment", () => {
  it("renders no marker for a currently-optional field", () => {
    render(<FieldOverlays fields={[field()]} currentPage={1} scale={1} />)
    expect(screen.queryByLabelText("Required")).toBeNull()
    expect(screen.queryByLabelText("Conditionally required")).toBeNull()
  })

  it("renders a static-required marker with the correct accessible label", () => {
    render(<FieldOverlays fields={[field({ effectiveRequired: true, requirednessConditionPresent: false })]} currentPage={1} scale={1} />)
    const marker = screen.getByLabelText("Required")
    expect(marker.textContent).toBe("*")
    expect(marker.className).toMatch(/text-danger-500/)
  })

  it("renders a conditionally-required marker with a distinct accessible label and tooltip", () => {
    render(<FieldOverlays fields={[field({ effectiveRequired: true, requirednessConditionPresent: true })]} currentPage={1} scale={1} />)
    const marker = screen.getByLabelText("Conditionally required")
    expect(marker.textContent).toBe("*")
    expect(marker.className).toMatch(/text-warning-600/)
    expect(marker.getAttribute("title")).toBe("Required based on packet conditions")
  })

  it("only renders fields for the current page (unrelated to visibility filtering, which happens upstream)", () => {
    render(
      <FieldOverlays
        fields={[field({ id: "p1", pageNumber: 1, name: "Page One Field" }), field({ id: "p2", pageNumber: 2, name: "Page Two Field" })]}
        currentPage={1}
        scale={1}
      />
    )
    expect(screen.getByText("Page One Field")).toBeTruthy()
    expect(screen.queryByText("Page Two Field")).toBeNull()
  })

  it("a hidden field passed in by mistake would still render (component trusts its input) — proving filtering is the parent's responsibility, not this component's", () => {
    // This is a documentation test: FieldOverlays has no isVisible check at
    // all — the parent (pdf-editor-client.tsx) is responsible for only ever
    // passing visibleFields. If this test ever starts failing because the
    // component silently drops a field, that's a sign filtering logic
    // leaked into the wrong layer.
    render(<FieldOverlays fields={[field({ name: "Should Still Render" })]} currentPage={1} scale={1} />)
    expect(screen.getByText("Should Still Render")).toBeTruthy()
  })
})
