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

vi.mock("@/lib/actions/documents", () => ({
  getEditableDocument: (...a: unknown[]) => getEditableDocumentMock(...a),
  saveDocumentFields: (...a: unknown[]) => saveDocumentFieldsMock(...a),
  createPdfVersion: (...a: unknown[]) => createPdfVersionMock(...a),
  addDocumentComment: (...a: unknown[]) => addDocumentCommentMock(...a),
  addPdfField: (...a: unknown[]) => addPdfFieldMock(...a),
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
