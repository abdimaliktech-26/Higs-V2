// Stage 5 Step 5b.2 — PendingAuthorizationPrompt: the portal dashboard's
// pending-signing-authorization banner. Shown only for an actionable
// pending authorization scoped to the currently selected client; absent
// for every other state, with no always-visible empty card.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"

const getPortalAccessAuthorizationForClientMock = vi.fn()

vi.mock("@/lib/actions/portal-access-authorizations", () => ({
  getPortalAccessAuthorizationForClient: (...a: unknown[]) => getPortalAccessAuthorizationForClientMock(...a),
}))

const CLIENT_ID = "client-0000001"
const OTHER_CLIENT_ID = "client-0000002"

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth-0000001",
    authorityType: "LEGAL_GUARDIAN",
    consentText: "Consent text.",
    consentVersion: "v1",
    effectiveDate: new Date("2026-01-01"),
    expirationDate: null,
    acceptedAt: null,
    revokedAt: null,
    hasSupportingDocument: false,
    relationship: "Mother",
    accessRole: "GUARDIAN",
    grantCanSignDocuments: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
})

async function renderPrompt(clientId = CLIENT_ID) {
  const { PendingAuthorizationPrompt } = await import("@/app/portal/(app)/dashboard/page")
  return render(await PendingAuthorizationPrompt({ clientId }))
}

describe("PendingAuthorizationPrompt — visibility", () => {
  it("25. appears for a pending, effective, unaccepted, unrevoked, unexpired authorization", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow())
    await renderPrompt()
    expect(screen.getByText("Review signing authorization")).toBeTruthy()
  })

  it("26. links to /portal/authorization?client=<currentClientId>", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow())
    await renderPrompt()
    const link = screen.getByRole("link", { name: /review authorization/i }) as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(`/portal/authorization?client=${CLIENT_ID}`)
  })

  it("27. states that reviewing does not sign a document", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow())
    await renderPrompt()
    expect(screen.getByText(/accepting it will not sign any document/i)).toBeTruthy()
  })

  it("29. is scoped to the currently selected client — passes exactly that client id to the read action", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow())
    await renderPrompt(OTHER_CLIENT_ID)
    expect(getPortalAccessAuthorizationForClientMock).toHaveBeenCalledWith(OTHER_CLIENT_ID)
    const link = screen.getByRole("link", { name: /review authorization/i }) as HTMLAnchorElement
    expect(link.getAttribute("href")).toBe(`/portal/authorization?client=${OTHER_CLIENT_ID}`)
  })
})

describe("PendingAuthorizationPrompt — absence for non-actionable states", () => {
  it("28a. does not render when already accepted", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ acceptedAt: new Date("2026-01-15") }))
    const { container } = await renderPrompt()
    expect(container.firstChild).toBeNull()
  })

  it("28b. does not render when revoked", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ revokedAt: new Date("2026-01-15") }))
    const { container } = await renderPrompt()
    expect(container.firstChild).toBeNull()
  })

  it("28c. does not render when expired", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ expirationDate: new Date("2020-01-01") }))
    const { container } = await renderPrompt()
    expect(container.firstChild).toBeNull()
  })

  it("28d. does not render when future-effective", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ effectiveDate: new Date("2099-01-01") }))
    const { container } = await renderPrompt()
    expect(container.firstChild).toBeNull()
  })

  it("28e. does not render when no authorization exists — and shows no empty card at all", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(null)
    const { container } = await renderPrompt()
    expect(container.firstChild).toBeNull()
  })
})
