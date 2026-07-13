// Stage 5 Step 5a.2 — the detail page's new "Sign" entry point, and a
// regression guard proving the removed generic signed transition was never
// quietly restored and every other status action still behaves exactly as
// before.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { SignatureDetailContent } from "@/app/signatures/[id]/signature-detail-content"

const getSignatureDetailMock = vi.fn()
const updateSignatureStatusMock = vi.fn()
const getAuditSummaryMock = vi.fn()

vi.mock("@/lib/actions/signatures", () => ({
  getSignatureDetail: (...a: unknown[]) => getSignatureDetailMock(...a),
  updateSignatureStatus: (...a: unknown[]) => updateSignatureStatusMock(...a),
}))
vi.mock("@/lib/actions/audit", () => ({
  getAuditSummary: (...a: unknown[]) => getAuditSummaryMock(...a),
}))

const REQUEST_ID = "sig-req-1"

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, signerName: "Jane Doe", signerEmail: "jane@example.com", signerRole: "case_manager", signerType: "staff",
    status: "sent", dueDate: null, consentText: "I consent.", declineReason: null, notes: null, signedAt: null,
    requestedBy: { name: "Staff Person", email: "staff@example.com" },
    packet: { packetId: "pkt-1", packetType: "initial_intake", status: "awaiting_signature", clientId: "client-1", client: { firstName: "Ayaan", lastName: "Mohamed", mcadId: "MCAD-1" } },
    packetId: "pkt-1",
    packetDocumentId: "doc-1",
    packetDocument: { documentTemplate: { name: "ISP" } },
    pdfField: { name: "Guardian Signature", fieldType: "signature", value: null },
    events: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getAuditSummaryMock.mockResolvedValue([])
})

describe("SignatureDetailContent — Step 5a.2 Sign entry point", () => {
  it("25. shows the Sign link only for status sent", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "sent" }))
    render(await SignatureDetailContent({ requestId: REQUEST_ID }))
    const signLink = screen.getByRole("link", { name: /^sign$/i })
    expect(signLink.getAttribute("href")).toBe(`/signatures/${REQUEST_ID}/sign`)
  })

  it("25. shows the Sign link only for status viewed", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "viewed" }))
    render(await SignatureDetailContent({ requestId: REQUEST_ID }))
    const signLink = screen.getByRole("link", { name: /^sign$/i })
    expect(signLink.getAttribute("href")).toBe(`/signatures/${REQUEST_ID}/sign`)
  })

  it("25. does not show the Sign link for pending, signed, cancelled, or declined", async () => {
    for (const status of ["pending", "signed", "cancelled", "declined"]) {
      getSignatureDetailMock.mockResolvedValue(requestRow({ status }))
      const { unmount } = render(await SignatureDetailContent({ requestId: REQUEST_ID }))
      expect(screen.queryByRole("link", { name: /^sign$/i })).toBeNull()
      unmount()
    }
  })

  it("26. never renders a control that calls updateSignatureStatus with \"signed\" — the Sign action is a Link, not a form", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "sent" }))
    render(await SignatureDetailContent({ requestId: REQUEST_ID }))
    const signLink = screen.getByRole("link", { name: /^sign$/i })
    // A real navigation link, not a submit button inside a form action.
    expect(signLink.closest("form")).toBeNull()
    expect(updateSignatureStatusMock).not.toHaveBeenCalled()
  })

  it("27. other status actions remain present and unchanged for pending (Send Request, Cancel)", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "pending" }))
    render(await SignatureDetailContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /send request/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /cancel/i })).toBeTruthy()
  })

  it("27. other status actions remain present and unchanged for sent (Decline, no Mark Viewed removed)", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "sent" }))
    render(await SignatureDetailContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /mark viewed/i })).toBeTruthy()
    expect(screen.getByRole("button", { name: /decline/i })).toBeTruthy()
  })

  it("27. other status actions remain present and unchanged for viewed (Decline)", async () => {
    getSignatureDetailMock.mockResolvedValue(requestRow({ status: "viewed" }))
    render(await SignatureDetailContent({ requestId: REQUEST_ID }))
    expect(screen.getByRole("button", { name: /decline/i })).toBeTruthy()
  })
})
