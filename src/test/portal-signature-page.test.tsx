// Stage 5 Step 5c.3 — server-side pre-render state branching on the portal
// signing ceremony page. UX-only shortcuts; executePortalSignature (tested
// in signatures-execute-portal.test.ts) remains the sole authorization
// boundary — these tests only prove the page shows the right state and
// never renders the form when it shouldn't.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const getPortalSignatureRequestForClientMock = vi.fn()

vi.mock("@/lib/actions/signatures", () => ({
  getPortalSignatureRequestForClient: (...a: unknown[]) => getPortalSignatureRequestForClientMock(...a),
  executePortalSignature: vi.fn(),
}))
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }))

const REQUEST_ID = "sig-req-1"
const CLIENT_ID = "client-1"
const DASHBOARD_HREF = `/portal/dashboard?client=${CLIENT_ID}`

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID, status: "sent", signerName: "Jane Doe", consentText: "Consent text here.",
    dueDate: null, clientDisplayName: "Ayaan Mohamed", documentName: "ISP",
    packetType: "initial_intake", isOverdue: false, eligible: true, ineligibleReason: null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow())
})

async function renderBody() {
  const { PortalSignatureBody } = await import("@/app/portal/(app)/signatures/[id]/sign/page")
  return render(await PortalSignatureBody({ requestId: REQUEST_ID, clientId: CLIENT_ID, dashboardHref: DASHBOARD_HREF }))
}

describe("PortalSignatureBody — signable state", () => {
  it("renders document/client/consent context and the signing form", async () => {
    await renderBody()
    expect(screen.getByRole("heading", { name: /electronic signature/i })).toBeTruthy()
    expect(screen.getByText(/ayaan mohamed/i)).toBeTruthy()
    expect(screen.getByText("ISP")).toBeTruthy()
    expect(screen.getByText("Consent text here.")).toBeTruthy()
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
  })

  it("shows an Overdue badge when the request is overdue", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ isOverdue: true }))
    await renderBody()
    expect(screen.getByText("Overdue")).toBeTruthy()
  })
})

describe("PortalSignatureBody — non-signable states never render the form", () => {
  it("no request found shows a not-found state, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(null)
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText("Signature request not found")).toBeTruthy()
  })

  it("a signed request shows a non-signable state, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ status: "signed" }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/already been completed/i)).toBeTruthy()
  })

  it("a cancelled request shows a non-signable state, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ status: "cancelled" }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
  })

  it("a pending request shows a non-signable state, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ status: "pending" }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
  })

  it("not-yet-enabled ineligibility shows a factual explanation, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ eligible: false, ineligibleReason: "not_enabled" }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/not yet enabled signing permission/i)).toBeTruthy()
  })

  it("not-authorized ineligibility shows a factual explanation, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ eligible: false, ineligibleReason: "not_authorized" }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/not currently accepted and effective/i)).toBeTruthy()
  })

  it("missing consent text shows a configuration state, no fallback consent language, no form", async () => {
    getPortalSignatureRequestForClientMock.mockResolvedValue(requestRow({ consentText: "" }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
    expect(screen.getByText(/no consent language configured/i)).toBeTruthy()
  })
})
