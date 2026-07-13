// Stage 5 Step 4c.3c.1 — PDFEditorClient: visible-field filtering, condition-
// aware counts, read-only banner priority, the post-save ignoredFieldIds
// notice, and defensive selection-clearing after a reload. Server actions
// and the real (pdfjs-dist-backed) PDFRenderer are mocked — the underlying
// evaluation/save logic they wrap is already exhaustively covered by
// documents-editable-dto.test.ts and documents-save-fields.test.ts; this
// file only tests what the client does with the DTO it's given.
//
// A field's name legitimately renders in more than one place at once (the
// canvas/no-PDF workspace AND the side field list), so presence checks use
// findAllByText/getAllByText rather than the singular findByText/getByText,
// and clicks target the element whose nearest ancestor is an actual
// <button> (only the field-list entry is interactive).
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { PDFEditorClient } from "@/app/documents/[id]/edit/pdf-editor-client"

const getEditableDocumentMock = vi.fn()
const saveDocumentFieldsMock = vi.fn()
const createPdfVersionMock = vi.fn()
const addDocumentCommentMock = vi.fn()
const addPdfFieldMock = vi.fn()
const evaluateDocumentFieldConditionsMock = vi.fn()

vi.mock("@/lib/actions/documents", () => ({
  getEditableDocument: (...a: unknown[]) => getEditableDocumentMock(...a),
  saveDocumentFields: (...a: unknown[]) => saveDocumentFieldsMock(...a),
  createPdfVersion: (...a: unknown[]) => createPdfVersionMock(...a),
  addDocumentComment: (...a: unknown[]) => addDocumentCommentMock(...a),
  addPdfField: (...a: unknown[]) => addPdfFieldMock(...a),
  evaluateDocumentFieldConditions: (...a: unknown[]) => evaluateDocumentFieldConditionsMock(...a),
}))

// Real PDFRenderer pulls in pdfjs-dist and does canvas rendering — stub it
// to just render children, matching the shape pdf-editor-client.tsx uses it
// with (<PDFRenderer ...>{children}</PDFRenderer>), including FieldOverlays.
vi.mock("@/components/pdf/pdf-renderer", () => ({
  PDFRenderer: ({ children }: { children?: React.ReactNode }) => <div data-testid="pdf-renderer-stub">{children}</div>,
}))

vi.mock("@/components/ai/copilot-panel", () => ({
  AiCopilotPanel: () => <div data-testid="ai-copilot-stub" />,
}))

const DOC_ID = "doc-1"

function baseField(overrides: Record<string, unknown> = {}) {
  return {
    id: "f1", name: "Field One", fieldType: "text", pageNumber: 1, posX: null, posY: null, width: null, height: null,
    value: null, source: "template", sortOrder: 0, confidence: 1,
    isRequired: false, staticRequired: false, effectiveRequired: false, isVisible: true,
    templateFieldKey: null, conditionallyRequired: false, visibilityConditionPresent: false, requirednessConditionPresent: false,
    ...overrides,
  }
}

function buildDoc(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, packetId: "pkt-1", status: "pending", currentVersion: 0, updatedAt: new Date("2024-01-01").toISOString(),
    documentTemplate: { name: "Admission Form", fileKey: null },
    packet: {
      status: "draft",
      client: { firstName: "Jane", lastName: "Doe", mcadId: "MCAD-1" },
      program: { name: "CADI" },
      assignedTo: { name: "Case Manager" },
    },
    fields: [baseField()],
    versions: [],
    comments: [],
    isReadOnly: false,
    readOnlyReason: null,
    isLockedByApproval: false,
    applicabilityStatus: "ACTIVE",
    conditionMode: "legacy",
    isConditionAware: false,
    hasConditionIntegrityError: false,
    conditionIntegrityErrorCount: 0,
    conditionConfigurationError: false,
    reconciliationPending: false,
    pdfUrl: null,
    ...overrides,
  }
}

// Clicks the interactive (button-ancestor) occurrence of a field's name —
// a field's name may also render in a non-interactive context (the
// no-PDF workspace list, or FieldOverlays' canvas marker), so this picks
// out the one that's actually wired to onSelectField/onFieldClick.
function clickField(name: string) {
  const matches = screen.getAllByText(name)
  const clickable = matches.find((el) => el.closest("button"))
  if (!clickable) throw new Error(`No clickable occurrence of "${name}" found`)
  fireEvent.click(clickable)
}

async function waitForField(name: string) {
  await waitFor(() => expect(screen.getAllByText(name).length).toBeGreaterThan(0))
}

beforeEach(() => {
  vi.clearAllMocks()
  saveDocumentFieldsMock.mockResolvedValue({ success: true, data: { status: "in_progress", ignoredFieldIds: [] } })
  createPdfVersionMock.mockResolvedValue({ success: true, data: { version: 1 } })
  evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: {} } })
})

describe("PDFEditorClient — visible-field filtering", () => {
  it("does not render a hidden field anywhere in the active editor", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true, conditionMode: "snapshot",
      fields: [
        baseField({ id: "visible-1", name: "Visible Field", isVisible: true }),
        baseField({ id: "hidden-1", name: "Hidden Field", isVisible: false, value: "leftover" }),
      ],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Visible Field")
    expect(screen.queryAllByText("Hidden Field")).toHaveLength(0)
  })

  it("excludes a hidden field from the per-page thumbnail count", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true,
      fields: [
        baseField({ id: "v1", name: "Visible", isVisible: true, pageNumber: 1 }),
        baseField({ id: "h1", name: "Hidden", isVisible: false, pageNumber: 1 }),
      ],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    const pageLabel = await screen.findByText("Page 1")
    const badge = pageLabel.parentElement?.querySelector("span:last-child")
    expect(badge?.textContent).toBe("1")
  })

  it("still renders the page itself even when every field on it is hidden", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true,
      fields: [baseField({ id: "h1", name: "Hidden Only", isVisible: false })],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await screen.findByText("Page 1")
    expect(screen.queryAllByText("Hidden Only")).toHaveLength(0)
  })
})

describe("PDFEditorClient — required markers", () => {
  it("shows a plain 'Required' badge for a statically required field and no conditional label", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      fields: [baseField({ id: "f1", name: "Static Req", isVisible: true, effectiveRequired: true, requirednessConditionPresent: false })],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Static Req")
    clickField("Static Req")
    expect(await screen.findByLabelText("Required")).toBeTruthy()
    expect(screen.queryByLabelText("Conditionally required")).toBeNull()
  })

  it("shows a distinct 'Conditionally Required' badge when requirednessConditionPresent is true", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true,
      fields: [baseField({ id: "f1", name: "Cond Req", isVisible: true, effectiveRequired: true, requirednessConditionPresent: true })],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Cond Req")
    clickField("Cond Req")
    const badge = await screen.findByLabelText("Conditionally required")
    expect(badge.textContent).toMatch(/Conditionally Required/)
    expect(badge.getAttribute("title")).toBe("Required based on packet conditions")
  })
})

describe("PDFEditorClient — metrics", () => {
  it("reports 100% completion when the only unfilled field is hidden", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true,
      fields: [
        baseField({ id: "v1", isVisible: true, value: "answered" }),
        baseField({ id: "h1", isVisible: false, effectiveRequired: false, value: null }),
      ],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitFor(() => expect(screen.getAllByText("100%").length).toBeGreaterThan(0))
  })
})

describe("PDFEditorClient — read-only banners", () => {
  it("renders the configuration-error banner with role=alert, taking priority over other read-only states", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true,
      conditionConfigurationError: true,
      applicabilityStatus: "CONDITIONALLY_INACTIVE",
      isLockedByApproval: true,
      isReadOnly: true,
      readOnlyReason: "This document has a compliance configuration error and cannot be edited until it is resolved.",
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    const banner = await screen.findByRole("alert")
    expect(banner.textContent).toMatch(/compliance configuration error/)
    expect(screen.queryByText(/not applicable based on packet conditions/)).toBeNull()
    expect(screen.queryByText(/approved and locked/)).toBeNull()
  })

  it("renders the inactive-document banner with role=status", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: true,
      applicabilityStatus: "CONDITIONALLY_INACTIVE",
      isReadOnly: true,
      readOnlyReason: "This document is currently not applicable based on packet conditions.",
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    const banners = await screen.findAllByRole("status")
    expect(banners.some((b) => /not applicable based on packet conditions/.test(b.textContent || ""))).toBe(true)
  })

  it("renders the approval-locked banner (existing behavior preserved)", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isLockedByApproval: true,
      isReadOnly: true,
      readOnlyReason: "This document is approved and locked for editing.",
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    const banners = await screen.findAllByRole("status")
    expect(banners.some((b) => /approved and locked/.test(b.textContent || ""))).toBe(true)
  })

  it("renders a generic role-based read-only banner when no other reason applies", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isReadOnly: true,
      readOnlyReason: "Your role has view-only access to this document.",
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    const banners = await screen.findAllByRole("status")
    expect(banners.some((b) => /view-only access/.test(b.textContent || ""))).toBe(true)
  })

  it("renders no read-only banner at all when the document is editable", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({}))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Field One")
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByText(/approved and locked|not applicable|configuration error|view-only/)).toBeNull()
  })
})

describe("PDFEditorClient — save notice", () => {
  it("shows a non-blocking notice when the save response has non-empty ignoredFieldIds", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({}))
    saveDocumentFieldsMock.mockResolvedValue({ success: true, data: { status: "in_progress", ignoredFieldIds: ["h1", "h2"] } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Field One")
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    const notice = await screen.findByText(/were not saved because they are currently hidden/)
    expect(notice.textContent).toBe("2 fields were not saved because they are currently hidden.")
    expect(notice.closest('[role="status"]')).toBeTruthy()
  })

  it("shows no notice when ignoredFieldIds is empty", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({}))
    saveDocumentFieldsMock.mockResolvedValue({ success: true, data: { status: "completed", ignoredFieldIds: [] } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Field One")
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(saveDocumentFieldsMock).toHaveBeenCalled())
    expect(screen.queryByText(/were not saved because/)).toBeNull()
  })

  it("does not treat a successful save with ignored fields as an error", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({}))
    saveDocumentFieldsMock.mockResolvedValue({ success: true, data: { status: "in_progress", ignoredFieldIds: ["h1"] } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Field One")
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await screen.findByText(/was not saved because it is currently hidden/)
    expect(createPdfVersionMock).toHaveBeenCalled()
  })

  it("still calls loadDoc's refresh (getEditableDocument) again after a save", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({}))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Field One")
    expect(getEditableDocumentMock).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(getEditableDocumentMock).toHaveBeenCalledTimes(2))
  })
})

describe("PDFEditorClient — selection clearing", () => {
  it("clears the selected field and does not crash when it is no longer visible after a reload", async () => {
    getEditableDocumentMock
      .mockResolvedValueOnce(buildDoc({
        isConditionAware: true,
        fields: [baseField({ id: "f1", name: "Was Visible", isVisible: true })],
      }))
      .mockResolvedValueOnce(buildDoc({
        isConditionAware: true,
        fields: [baseField({ id: "f1", name: "Was Visible", isVisible: false })],
      }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Was Visible")
    clickField("Was Visible")
    expect(await screen.findByText(/text - Page 1/i)).toBeTruthy()

    // Trigger a reload the same way a save does.
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(getEditableDocumentMock).toHaveBeenCalledTimes(2))
    await waitFor(() => expect(screen.queryAllByText("Was Visible")).toHaveLength(0))
    // No crash, no stale selected-field detail panel left over.
    expect(screen.queryByText(/text - Page 1/i)).toBeNull()
  })
})

describe("PDFEditorClient — legacy document compatibility", () => {
  it("renders every field visible with only static required markers, no conditional indicator, and no read-only banner", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: false, conditionMode: "legacy",
      fields: [
        baseField({ id: "f1", name: "Legacy Required", isVisible: true, isRequired: true, effectiveRequired: true, requirednessConditionPresent: false }),
        baseField({ id: "f2", name: "Legacy Optional", isVisible: true, isRequired: false, effectiveRequired: false }),
      ],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Legacy Required")
    expect(screen.getAllByText("Legacy Optional").length).toBeGreaterThan(0)
    expect(screen.queryByRole("alert")).toBeNull()
    expect(screen.queryByLabelText("Conditionally required")).toBeNull()

    clickField("Legacy Required")
    expect(await screen.findByLabelText("Required")).toBeTruthy()
  })
})

// ── Step 4c.3c.2 — debounced, read-only, real-time condition evaluation ──
//
// Real timers throughout (no vi.useFakeTimers()) — deliberately, since
// mixing fake timers with React state updates and testing-library's async
// queries is a well-known source of flakiness. The debounce/slow-threshold
// constants in pdf-editor-client.tsx are 350ms/500ms; waits below use a
// comfortable margin above that. Stale-response ordering is made
// deterministic via manually-controlled promises rather than real timing
// races.
function conditionAwareDoc(overrides: Record<string, unknown> = {}) {
  return buildDoc({
    isConditionAware: true, conditionMode: "snapshot",
    fields: [
      baseField({ id: "trigger", name: "Trigger", fieldType: "checkbox", templateFieldKey: "trigger", isVisible: true, value: null }),
      baseField({ id: "dependent", name: "Dependent", fieldType: "text", templateFieldKey: "dependent", isVisible: true, value: "existing" }),
    ],
    ...overrides,
  })
}

async function selectAndGetInput(name: string) {
  clickField(name)
  return screen.findByLabelText("Value")
}

describe("PDFEditorClient — 4c.3c.2: debounce triggering", () => {
  it("schedules exactly one evaluation request after editing a field with a template identity", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "true" } })
    expect(evaluateDocumentFieldConditionsMock).not.toHaveBeenCalled()
    await new Promise((r) => setTimeout(r, 450))
    expect(evaluateDocumentFieldConditionsMock).toHaveBeenCalledTimes(1)
    const [calledDocId, calledFields] = evaluateDocumentFieldConditionsMock.mock.calls[0]
    expect(calledDocId).toBe(DOC_ID)
    expect(calledFields).toContainEqual({ id: "trigger", value: "true" })
  })

  it("collapses multiple rapid edits into one effective request, using the latest value", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const depInput = await selectAndGetInput("Dependent")
    fireEvent.change(depInput, { target: { value: "a" } })
    await new Promise((r) => setTimeout(r, 100))
    fireEvent.change(depInput, { target: { value: "ab" } })
    await new Promise((r) => setTimeout(r, 100))
    fireEvent.change(depInput, { target: { value: "abc" } })
    await new Promise((r) => setTimeout(r, 450))
    expect(evaluateDocumentFieldConditionsMock).toHaveBeenCalledTimes(1)
    const [, calledFields] = evaluateDocumentFieldConditionsMock.mock.calls[0]
    expect(calledFields).toContainEqual({ id: "dependent", value: "abc" })
  })

  it("never triggers an evaluation request for a legacy document", async () => {
    getEditableDocumentMock.mockResolvedValue(buildDoc({
      isConditionAware: false,
      fields: [baseField({ id: "f1", name: "Legacy Field", templateFieldKey: "whatever", isVisible: true })],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Legacy Field")
    const input = await selectAndGetInput("Legacy Field")
    fireEvent.change(input, { target: { value: "x" } })
    await new Promise((r) => setTimeout(r, 450))
    expect(evaluateDocumentFieldConditionsMock).not.toHaveBeenCalled()
  })

  it("never triggers an evaluation request for a manual field with no template identity", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc({
      fields: [baseField({ id: "m1", name: "Manual Field", templateFieldKey: null, isVisible: true })],
    }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Manual Field")
    const input = await selectAndGetInput("Manual Field")
    fireEvent.change(input, { target: { value: "x" } })
    await new Promise((r) => setTimeout(r, 450))
    expect(evaluateDocumentFieldConditionsMock).not.toHaveBeenCalled()
  })

  it("has no editable input at all for a read-only document, so no request can ever be triggered", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc({ isReadOnly: true, readOnlyReason: "Your role has view-only access to this document." }))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    clickField("Trigger")
    // Read-only fields render a static value display, never an <Input>.
    expect(screen.queryByLabelText("Value")).toBeNull()
    await new Promise((r) => setTimeout(r, 450))
    expect(evaluateDocumentFieldConditionsMock).not.toHaveBeenCalled()
  })
})

describe("PDFEditorClient — 4c.3c.2: real-time visibility and requiredness", () => {
  it("hides a dependent field immediately after a controller edit, without saving or reloading", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { dependent: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    expect(screen.getAllByText("Dependent").length).toBeGreaterThan(0)
    const input = await selectAndGetInput("Trigger")
    // fireEvent.change to the SAME value the controlled input already holds
    // ("" here, since trigger's initial value is null) never fires React's
    // onChange at all (its value-tracker suppresses it) — use a value that
    // actually differs from the current one to represent "unchecking".
    fireEvent.change(input, { target: { value: "false" } })
    await waitFor(() => expect(screen.queryAllByText("Dependent")).toHaveLength(0), { timeout: 2000 })
    expect(saveDocumentFieldsMock).not.toHaveBeenCalled()
    expect(getEditableDocumentMock).toHaveBeenCalledTimes(1)
  })

  it("reveals a previously-hidden field again, preserving its prior local value", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc({
      fields: [
        baseField({ id: "trigger", name: "Trigger", fieldType: "checkbox", templateFieldKey: "trigger", isVisible: true, value: null }),
        baseField({ id: "dependent", name: "Dependent", fieldType: "text", templateFieldKey: "dependent", isVisible: false, value: "kept value" }),
      ],
    }))
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { dependent: { isVisible: true, effectiveRequired: false, conditionallyRequired: false } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    expect(screen.queryAllByText("Dependent")).toHaveLength(0)
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "true" } })
    await waitFor(() => expect(screen.getAllByText("Dependent").length).toBeGreaterThan(0), { timeout: 2000 })
    const depInput = await selectAndGetInput("Dependent")
    expect((depInput as HTMLInputElement).value).toBe("kept value")
  })

  it("updates the required marker immediately when evaluation reports a conditionally-required transition", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc({
      fields: [
        baseField({ id: "trigger", name: "Trigger", fieldType: "checkbox", templateFieldKey: "trigger", isVisible: true, value: null }),
        baseField({ id: "reqd", name: "Reqd Field", fieldType: "text", templateFieldKey: "reqd_field", isVisible: true, value: null, effectiveRequired: false, requirednessConditionPresent: true }),
      ],
    }))
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { reqd: { isVisible: true, effectiveRequired: true, conditionallyRequired: true } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "true" } })
    await new Promise((r) => setTimeout(r, 500))
    const reqdInput = await selectAndGetInput("Reqd Field")
    expect(reqdInput).toBeTruthy()
    expect(await screen.findByLabelText("Conditionally required")).toBeTruthy()
  })
})

describe("PDFEditorClient — 4c.3c.2: stale-response protection", () => {
  it("a slower earlier response can never overwrite a later response", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    let resolveFirst: (v: unknown) => void = () => {}
    let resolveSecond: (v: unknown) => void = () => {}
    const firstPromise = new Promise((r) => { resolveFirst = r })
    const secondPromise = new Promise((r) => { resolveSecond = r })
    evaluateDocumentFieldConditionsMock.mockImplementationOnce(() => firstPromise).mockImplementationOnce(() => secondPromise)

    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")

    fireEvent.change(input, { target: { value: "true" } })
    await new Promise((r) => setTimeout(r, 420)) // first debounce fires; first request now in flight
    expect(evaluateDocumentFieldConditionsMock).toHaveBeenCalledTimes(1)

    fireEvent.change(input, { target: { value: "false" } })
    await new Promise((r) => setTimeout(r, 420)) // second debounce fires; second request now also in flight
    expect(evaluateDocumentFieldConditionsMock).toHaveBeenCalledTimes(2)

    // Resolve out of order: the newer (second) request resolves first with
    // "visible", then the stale (first) request resolves with "hidden".
    resolveSecond({ success: true, data: { fields: { dependent: { isVisible: true, effectiveRequired: false, conditionallyRequired: false } } } })
    await new Promise((r) => setTimeout(r, 50))
    resolveFirst({ success: true, data: { fields: { dependent: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } } } })
    await new Promise((r) => setTimeout(r, 50))

    // The latest (second) request's result must win — dependent stays visible.
    expect(screen.getAllByText("Dependent").length).toBeGreaterThan(0)
  })
})

describe("PDFEditorClient — 4c.3c.2: selection, focus, and accessibility", () => {
  it("clears the selection and shows a non-blocking notice when the evaluation reports the selected field as hidden", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { trigger: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "x" } })
    await waitFor(() => expect(screen.getByText("This field is no longer applicable.")).toBeTruthy(), { timeout: 2000 })
  })

  it("announces a visible-to-hidden transition in the polite live region, using the field's display name only", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { dependent: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "false" } })
    await waitFor(() => {
      const region = document.querySelector('[aria-live="polite"]')
      expect(region?.textContent).toBe("Dependent is no longer applicable.")
    }, { timeout: 2000 })
  })

  it("does not announce anything on initial load, before any edit", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const region = document.querySelector('[aria-live="polite"]')
    expect(region?.textContent).toBe("")
  })
})

describe("PDFEditorClient — 4c.3c.2: evaluation failure handling", () => {
  it("keeps the last known state and shows a fallback warning when evaluation fails, without crashing", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: false, error: "boom" })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "true" } })
    await waitFor(() => expect(screen.getByText(/Live condition updates are temporarily unavailable/)).toBeTruthy(), { timeout: 2000 })
    // Dependent's state is unchanged (still visible, per the base DTO) —
    // the failed evaluation never guessed hidden/optional.
    expect(screen.getAllByText("Dependent").length).toBeGreaterThan(0)
  })

  it("keeps the editor and Save usable after an evaluation failure", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockRejectedValue(new Error("network error"))
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "true" } })
    await waitFor(() => expect(screen.getByText(/Live condition updates are temporarily unavailable/)).toBeTruthy(), { timeout: 2000 })
    const saveButton = screen.getByRole("button", { name: /^Save$/ })
    expect(saveButton).not.toBeDisabled()
    fireEvent.click(saveButton)
    await waitFor(() => expect(saveDocumentFieldsMock).toHaveBeenCalled())
  })
})

describe("PDFEditorClient — 4c.3c.2: save/reload interaction", () => {
  it("never includes client-computed condition results in the save payload", async () => {
    getEditableDocumentMock.mockResolvedValue(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { dependent: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "false" } })
    await waitFor(() => expect(screen.queryAllByText("Dependent")).toHaveLength(0), { timeout: 2000 })
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(saveDocumentFieldsMock).toHaveBeenCalled())
    const submittedFields = saveDocumentFieldsMock.mock.calls[0][1] as any[]
    for (const f of submittedFields) {
      expect(Object.keys(f).sort()).toEqual(["fieldType", "id", "isRequired", "name", "pageNumber", "posX", "posY", "value"].sort())
    }
  })

  it("replaces optimistic state with fresh server data after a save/reload", async () => {
    getEditableDocumentMock
      .mockResolvedValueOnce(conditionAwareDoc())
      .mockResolvedValueOnce(conditionAwareDoc())
    evaluateDocumentFieldConditionsMock.mockResolvedValue({ success: true, data: { fields: { dependent: { isVisible: false, effectiveRequired: false, conditionallyRequired: false } } } })
    render(<PDFEditorClient documentId={DOC_ID} />)
    await waitForField("Trigger")
    const input = await selectAndGetInput("Trigger")
    fireEvent.change(input, { target: { value: "false" } })
    await waitFor(() => expect(screen.queryAllByText("Dependent")).toHaveLength(0), { timeout: 2000 })
    fireEvent.click(screen.getByRole("button", { name: /^Save$/ }))
    await waitFor(() => expect(getEditableDocumentMock).toHaveBeenCalledTimes(2))
    // The second load's server DTO says dependent is visible again — the
    // stale optimistic "hidden" overlay must not survive the reload.
    await waitFor(() => expect(screen.getAllByText("Dependent").length).toBeGreaterThan(0), { timeout: 2000 })
  })
})
