// Stage 5 Step 5b.2 — structural signing-scope regression. Confirms this
// step added no active portal-signing navigation and left the existing,
// pre-5b.2 disabled "Coming Soon" Signatures placeholder in PortalShell
// completely untouched.
import { describe, it, expect, vi } from "vitest"
import { render, screen } from "@testing-library/react"
import { PortalShell } from "@/app/portal/portal-shell"

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/portal/dashboard",
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock("@/lib/actions/portal-auth", () => ({ portalLogout: vi.fn() }))

const CLIENTS = [{ clientId: "client-1", displayName: "Ayaan Mohamed", relationship: "Mother", accessRole: "GUARDIAN" }]

describe("PortalShell — signing-scope regression", () => {
  it("the 'Signatures' entry is present only as a disabled, non-link Coming Soon item", () => {
    render(<PortalShell clients={CLIENTS} currentClientId="client-1"><div /></PortalShell>)
    const entries = screen.getAllByText("Signatures")
    expect(entries.length).toBeGreaterThan(0)
    for (const entry of entries) {
      const container = entry.closest("a, div")
      expect(container?.tagName).not.toBe("A")
    }
  })

  it("no real nav link is labeled 'Signatures' or 'Sign'", () => {
    render(<PortalShell clients={CLIENTS} currentClientId="client-1"><div /></PortalShell>)
    const links = screen.getAllByRole("link")
    const signingLink = links.find((l) => /sign/i.test(l.textContent || ""))
    expect(signingLink).toBeUndefined()
  })

  it("the real nav items are exactly Home, Documents, Upload Center, Care Team, Notifications, Settings", () => {
    render(<PortalShell clients={CLIENTS} currentClientId="client-1"><div /></PortalShell>)
    const links = screen.getAllByRole("link").map((l) => l.textContent)
    for (const label of ["Home", "Documents", "Upload Center", "Care Team", "Notifications", "Settings"]) {
      expect(links).toContain(label)
    }
  })
})
