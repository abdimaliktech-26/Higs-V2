// Stage 5 Step 5b.2 — server-side pre-render state branching on the portal
// authorization ceremony page. These are UX-only shortcuts;
// acceptPortalAccessAuthorization (tested separately in
// portal-access-authorization-acceptance.test.ts) remains the sole
// authorization/integrity boundary — these tests only prove the page shows
// the right state and never renders the form when it shouldn't.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen } from "@testing-library/react"
import { formatDate } from "@/lib/utils"

const getPortalAccessAuthorizationForClientMock = vi.fn()
const acceptPortalAccessAuthorizationMock = vi.fn()

vi.mock("@/lib/actions/portal-access-authorizations", () => ({
  getPortalAccessAuthorizationForClient: (...a: unknown[]) => getPortalAccessAuthorizationForClientMock(...a),
  acceptPortalAccessAuthorization: (...a: unknown[]) => acceptPortalAccessAuthorizationMock(...a),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}))

const CLIENT_ID = "client-0000001"

function authorizationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "auth-0000001",
    authorityType: "LEGAL_GUARDIAN",
    consentText: "I consent to sign on this client's behalf.",
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
  getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow())
})

async function renderBody(overrides: Record<string, unknown> = {}) {
  const { PortalAuthorizationBody } = await import("@/app/portal/(app)/authorization/page")
  return render(
    await PortalAuthorizationBody({
      clientId: CLIENT_ID,
      clientDisplayName: "Ayaan Mohamed",
      dashboardHref: `/portal/dashboard?client=${CLIENT_ID}`,
      ...overrides,
    })
  )
}

describe("PortalAuthorizationBody — pending actionable state", () => {
  it("1. renders page title, client identity, authority type, access role, relationship, effective date", async () => {
    await renderBody()
    expect(screen.getByRole("heading", { name: /review signing authorization/i })).toBeTruthy()
    expect(screen.getByText(/reviewing signing authority for ayaan mohamed/i)).toBeTruthy()
    expect(screen.getByText(/legal guardian/i)).toBeTruthy()
    expect(screen.getByText((_, el) => el?.tagName === "P" && el.textContent === "Access role: Guardian · Mother")).toBeTruthy()
    expect(screen.getByText(/effective/i)).toBeTruthy()
  })

  it("1b. displays the expiration date when present", async () => {
    const expirationDate = new Date("2027-01-01")
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ expirationDate }))
    await renderBody()
    expect(screen.getByText((_, el) => el?.tagName === "P" && !!el.textContent?.includes(formatDate(expirationDate)))).toBeTruthy()
  })

  it("1c. displays the supporting-document-on-file indicator only when present", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ hasSupportingDocument: true }))
    await renderBody()
    expect(screen.getByText(/supporting documentation is on file/i)).toBeTruthy()
  })

  it("1d. omits the supporting-document indicator when absent", async () => {
    await renderBody()
    expect(screen.queryByText(/supporting documentation is on file/i)).toBeNull()
  })

  it("2. consent text renders exactly as stored", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ consentText: "Exact stored consent wording." }))
    await renderBody()
    expect(screen.getByText("Exact stored consent wording.")).toBeTruthy()
  })

  it("3. consent text preserves line breaks", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ consentText: "Line one.\nLine two." }))
    await renderBody()
    const consentBlock = screen.getByText((_, el) => el?.textContent === "Line one.\nLine two." && el.tagName === "DIV")
    expect(consentBlock.className).toContain("whitespace-pre-wrap")
  })

  it("4. consent version is displayed", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ consentVersion: "v7-final" }))
    await renderBody()
    expect(screen.getByText(/v7-final/)).toBeTruthy()
  })

  it("5. no typed-name input renders anywhere on the page", async () => {
    await renderBody()
    expect(screen.queryByRole("textbox")).toBeNull()
  })

  it("renders the acceptance form's checkbox and submit button", async () => {
    await renderBody()
    expect(screen.getByRole("checkbox")).toBeTruthy()
    expect(screen.getByRole("button", { name: /accept authorization/i })).toBeTruthy()
  })
})

describe("PortalAuthorizationBody — non-actionable states never render the form", () => {
  it("20. an already-accepted authorization shows the completed state, not the form", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ acceptedAt: new Date("2026-01-15") }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /accept authorization/i })).toBeNull()
    expect(screen.getByText("You have already accepted this signing authorization.")).toBeTruthy()
  })

  it("20b. the accepted state explains whether signing permission is enabled", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ acceptedAt: new Date("2026-01-15"), grantCanSignDocuments: true }))
    await renderBody()
    expect(screen.getByText(/signing permission is currently enabled/i)).toBeTruthy()
  })

  it("21. a revoked authorization shows the revoked state, not the form", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ revokedAt: new Date("2026-01-15") }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /accept authorization/i })).toBeNull()
    expect(screen.getByText("This signing authorization has been revoked and can no longer be accepted.")).toBeTruthy()
  })

  it("22. an expired authorization shows the expired state, not the form", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ expirationDate: new Date("2020-01-01") }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /accept authorization/i })).toBeNull()
    expect(screen.getByText("This signing authorization has expired.")).toBeTruthy()
  })

  it("23. a future-effective authorization shows the not-yet-available state with the effective date, not the form", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(authorizationRow({ effectiveDate: new Date("2099-06-01") }))
    await renderBody()
    expect(screen.queryByRole("button", { name: /accept authorization/i })).toBeNull()
    expect(screen.getByText("This signing authorization is not yet available for acceptance.")).toBeTruthy()
    expect(screen.getByText(/becomes available on/i)).toBeTruthy()
  })

  it("24. no authorization shows a simple, non-error empty state", async () => {
    getPortalAccessAuthorizationForClientMock.mockResolvedValue(null)
    await renderBody()
    expect(screen.queryByRole("button", { name: /accept authorization/i })).toBeNull()
    expect(screen.getByText("No signing authorization to review")).toBeTruthy()
    // Not an error-styled presentation: no role="alert" and no error/danger icon container.
    expect(screen.queryByRole("alert")).toBeNull()
  })
})
