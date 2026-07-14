// Stage 5 Step 5c.3 — PendingSignaturePrompt: the portal dashboard's
// pending-signature discovery banner. Shown only when
// getPendingPortalSignatureRequest finds an actionable request for the
// currently selected client; absent otherwise, with no always-visible
// empty card. This is the sole discovery surface for this step — no
// signature list, no active Signatures nav item.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const getPendingPortalSignatureRequestMock = vi.fn()

vi.mock("@/lib/actions/signatures", () => ({
  getPendingPortalSignatureRequest: (...a: unknown[]) => getPendingPortalSignatureRequestMock(...a),
}))

const CLIENT_ID = "client-1"
const OTHER_CLIENT_ID = "client-2"

beforeEach(() => {
  vi.clearAllMocks()
})

async function renderPrompt(clientId = CLIENT_ID) {
  const { PendingSignaturePrompt } = await import("@/app/portal/(app)/dashboard/page")
  return render(await PendingSignaturePrompt({ clientId }))
}

describe("PendingSignaturePrompt — visibility", () => {
  it("appears when an eligible pending signature request exists", async () => {
    getPendingPortalSignatureRequestMock.mockResolvedValue({ requestId: "sig-req-1", count: 1 })
    await renderPrompt()
    expect(screen.getByText("Document ready to sign")).toBeTruthy()
  })

  it("links to /portal/signatures/<requestId>/sign?client=<clientId>", async () => {
    getPendingPortalSignatureRequestMock.mockResolvedValue({ requestId: "sig-req-1", count: 1 })
    await renderPrompt()
    const link = screen.getByRole("link", { name: /review and sign/i }) as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(`/portal/signatures/sig-req-1/sign?client=${CLIENT_ID}`)
  })

  it("uses singular copy for exactly one document", async () => {
    getPendingPortalSignatureRequestMock.mockResolvedValue({ requestId: "sig-req-1", count: 1 })
    await renderPrompt()
    expect(screen.getByText(/a document waiting for your electronic signature/i)).toBeTruthy()
  })

  it("uses plural copy for multiple documents", async () => {
    getPendingPortalSignatureRequestMock.mockResolvedValue({ requestId: "sig-req-1", count: 3 })
    await renderPrompt()
    expect(screen.getByText(/you have 3 documents waiting/i)).toBeTruthy()
  })

  it("is scoped to the currently selected client", async () => {
    getPendingPortalSignatureRequestMock.mockResolvedValue({ requestId: "sig-req-1", count: 1 })
    await renderPrompt(OTHER_CLIENT_ID)
    expect(getPendingPortalSignatureRequestMock).toHaveBeenCalledWith(OTHER_CLIENT_ID)
    const link = screen.getByRole("link", { name: /review and sign/i }) as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(`/portal/signatures/sig-req-1/sign?client=${OTHER_CLIENT_ID}`)
  })
})

describe("PendingSignaturePrompt — absence", () => {
  it("does not render when there is no pending signature request, and shows no empty card", async () => {
    getPendingPortalSignatureRequestMock.mockResolvedValue(null)
    const { container } = await renderPrompt()
    expect(container.firstChild).toBeNull()
  })
})
