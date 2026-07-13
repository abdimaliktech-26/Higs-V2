// Stage 5 Step 5a.2 — server-side pre-render guards on the staff signing
// page. These are UX-only shortcuts; executeStaffSignature (tested
// separately in signatures-execute.test.ts) remains the sole authorization
// and integrity boundary — these tests only prove the page shows the right
// state and never renders the form when it shouldn't.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const authMock = vi.fn()
const getSignatureDetailMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/actions/signatures", () => ({
  getSignatureDetail: (...a: unknown[]) => getSignatureDetailMock(...a),
  executeStaffSignature: vi.fn(),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  redirect: vi.fn(),
}))

const REQUEST_ID = "sig-req-1"
const STAFF_EMAIL = "case.manager@example.com"

function staffSession(overrides: Record<string, unknown> = {}) {
  return { user: { id: "staff-1", email: STAFF_EMAIL, ...overrides } }
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, signerName: "Jane Doe", signerEmail: STAFF_EMAIL, signerRole: "case_manager", signerType: "staff",
    status: "sent", dueDate: null, consentText: "I consent to sign this electronically.",
    packetId: "pkt-1", packetDocumentId: "doc-1",
    packet: { packetType: "initial_intake", status: "awaiting_signature", client: { firstName: "Ayaan", lastName: "Mohamed" } },
    packetDocument: { documentTemplate: { name: "ISP" } },
    pdfField: { name: "Guardian Signature", fieldType: "signature", value: null },
    events: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(staffSession())
  getSignatureDetailMock.mockResolvedValue(requestRow())
})

describe("SignaturePageContent — signable states", () => {
  it("1. renders the signing form for a matching staff signer with status sent", async () => {
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
  })

  it("2. renders the signing form for a matching staff signer with status viewed", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "viewed" }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
  })

  it("4. the signer summary displays the expected signer name", async () => {
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.getAllByText("Jane Doe").length).toBeGreaterThan(0)
  })

  it("5. the consent text is rendered with preserved line breaks", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ consentText: "Line one.\nLine two." }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    const consentBlock = screen.getByText((_, el) => el?.textContent === "Line one.\nLine two." && el.tagName === "DIV")
    expect(consentBlock.className).toContain("whitespace-pre-wrap")
  })

  it("23. an overdue but still-sent request remains signable", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "sent", dueDate: new Date("2020-01-01") }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
    expect(screen.getByText("Overdue")).toBeTruthy()
  })

  it("24. an overdue but still-viewed request remains signable", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "viewed", dueDate: new Date("2020-01-01") }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
  })
})

describe("SignaturePageContent — non-signable states never render the form", () => {
  it("17. a signed request shows a non-signable state, no form", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "signed" }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/already been completed/i)).toBeTruthy()
  })

  it("18. a cancelled request shows a non-signable state, no form", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "cancelled" }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/has been cancelled and cannot be signed/i)).toBeTruthy()
  })

  it("19. a declined request shows a non-signable state, no form", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "declined" }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/was declined and cannot be signed/i)).toBeTruthy()
  })

  it("20. a pending request shows a non-signable state, no form", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "pending" }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/not yet ready/i)).toBeTruthy()
  })

  it("21. an email mismatch shows the assigned-to-a-different-signer state, no form, and reveals no extra signer info", async () => {
    authMock.mockResolvedValue(staffSession({ email: "someone.else@example.com" }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText("This signature request is assigned to a different signer.")).toBeTruthy()
    // Does not leak the signer's email/role beyond what the detail page already shows.
    expect(screen.queryByText(STAFF_EMAIL)).toBeNull()
  })

  it("treats email comparison as case/whitespace-insensitive (matches, so the form renders)", async () => {
    authMock.mockResolvedValue(staffSession({ email: `  ${STAFF_EMAIL.toUpperCase()}  ` }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
  })

  it("22. missing consent text shows a configuration error, no form, and no fallback consent language", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ consentText: null }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/no consent language configured/i)).toBeTruthy()
  })

  it("blank (whitespace-only) consent text is treated the same as missing", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ consentText: "   " }))
    const { SignaturePageContent } = await import("@/app/signatures/[id]/sign/page")
    render(await SignaturePageContent({ requestId: REQUEST_ID }))
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
  })
})
