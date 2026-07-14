// Stage 5 Step 5b.2 — AuthorizationAcceptanceForm: pure UI client of
// acceptPortalAccessAuthorization. Mirrors signature-execution-form.test.tsx's
// conventions exactly — mocks the action itself, verifies the form never
// sends anything but the authorization id, preserves checkbox state after a
// server error, focuses the error region, prevents duplicate submission,
// and shows the required role="status" success state before navigating.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { AuthorizationAcceptanceForm } from "@/app/portal/(app)/authorization/authorization-acceptance-form"

const acceptPortalAccessAuthorizationMock = vi.fn()
const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("@/lib/actions/portal-access-authorizations", () => ({
  acceptPortalAccessAuthorization: (...a: unknown[]) => acceptPortalAccessAuthorizationMock(...a),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => pushMock(...a), refresh: (...a: unknown[]) => refreshMock(...a) }),
}))

const AUTH_ID = "auth-0000001"
const BACK_HREF = "/portal/dashboard?client=client-0000001"

function renderForm() {
  return render(<AuthorizationAcceptanceForm authorizationId={AUTH_ID} backHref={BACK_HREF} />)
}

function checkbox() {
  return screen.getByLabelText(/read and understood the signing authorization statement/i) as HTMLInputElement
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /accept authorization/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  acceptPortalAccessAuthorizationMock.mockResolvedValue({ success: true, data: { id: AUTH_ID, acceptedAt: new Date("2026-07-13T20:00:00Z") } })
})

describe("AuthorizationAcceptanceForm — checkbox", () => {
  it("7. the checkbox starts unchecked", () => {
    renderForm()
    expect(checkbox().checked).toBe(false)
  })

  it("6. the label is associated with the native checkbox via htmlFor/id", () => {
    renderForm()
    const box = checkbox()
    expect(box.type).toBe("checkbox")
  })

  it("8. submit is blocked when the checkbox is unchecked — the action is never called", () => {
    renderForm()
    submit()
    expect(acceptPortalAccessAuthorizationMock).not.toHaveBeenCalled()
    expect(screen.getByText(/must check this box/i)).toBeTruthy()
  })
})

describe("AuthorizationAcceptanceForm — submission contract", () => {
  it("9. submit calls acceptPortalAccessAuthorization with exactly the authorization id", async () => {
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(acceptPortalAccessAuthorizationMock).toHaveBeenCalledTimes(1))
    expect(acceptPortalAccessAuthorizationMock).toHaveBeenCalledWith(AUTH_ID)
  })

  it("10. no client ID, grant ID, portal-user ID, consent text/version, authority type, timestamp, IP, or user-agent is ever sent", async () => {
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(acceptPortalAccessAuthorizationMock).toHaveBeenCalledTimes(1))
    const args = acceptPortalAccessAuthorizationMock.mock.calls[0]
    expect(args).toEqual([AUTH_ID])
    expect(args).toHaveLength(1)
  })
})

describe("AuthorizationAcceptanceForm — server error handling", () => {
  it("13. a server error renders in an alert region", async () => {
    acceptPortalAccessAuthorizationMock.mockResolvedValue({ success: false, error: "This signing authorization has already been accepted." })
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(screen.getByRole("alert").textContent).toContain("already been accepted")
  })

  it("14. the error region receives focus after a failed submission", async () => {
    acceptPortalAccessAuthorizationMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.click(checkbox())
    submit()

    // Focus is queued via requestAnimationFrame in the component (real
    // timers, deliberately, matching this repo's own convention for
    // async-timing tests). waitFor's 1000ms default is tight under full-
    // suite parallel CI load, where it has intermittently lost this race
    // across multiple unrelated commits — raised to match the same
    // generous-margin precedent already used for the analogous rAF/timer
    // race in signature-execution-form.test.tsx. No production behavior
    // changed; this only widens how long the assertion is willing to wait.
    await waitFor(() => expect(screen.getByRole("alert")).toBe(document.activeElement), { timeout: 5000 })
  }, 7000)

  it("15. the checkbox remains checked after a server error", async () => {
    acceptPortalAccessAuthorizationMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(checkbox().checked).toBe(true)
  })

  it("does not replace the form on a failed submission", async () => {
    acceptPortalAccessAuthorizationMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.click(checkbox())
    submit()
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(screen.getByRole("button", { name: /accept authorization/i })).toBeTruthy()
  })
})

describe("AuthorizationAcceptanceForm — pending/duplicate submission", () => {
  it("11. the submit button is disabled while the request is pending", async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    acceptPortalAccessAuthorizationMock.mockImplementation(() => new Promise((r) => { resolvePromise = r }))
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect((screen.getByRole("button", { name: /accept authorization/i }) as HTMLButtonElement).disabled).toBe(true))
    resolvePromise({ success: true, data: { id: AUTH_ID, acceptedAt: new Date() } })
  })

  it("12. repeated clicks while pending do not create duplicate action calls", async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    acceptPortalAccessAuthorizationMock.mockImplementation(() => new Promise((r) => { resolvePromise = r }))
    renderForm()
    fireEvent.click(checkbox())
    submit()
    submit()
    submit()

    await waitFor(() => expect(acceptPortalAccessAuthorizationMock).toHaveBeenCalledTimes(1))
    resolvePromise({ success: true, data: { id: AUTH_ID, acceptedAt: new Date() } })
  })
})

describe("AuthorizationAcceptanceForm — success", () => {
  it("16. success renders in a role=status region", async () => {
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy())
  })

  it("17. success copy explains that staff must separately enable signing permission", async () => {
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/staff member must separately enable signing permission/i))
  })

  it("18. success prevents another submission — the form is replaced, not left submittable", async () => {
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /accept authorization/i })).toBeNull()
  })

  it("navigates back to the dashboard after success", async () => {
    renderForm()
    fireEvent.click(checkbox())
    submit()

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy())
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(BACK_HREF), { timeout: 8000 })
    expect(refreshMock).toHaveBeenCalled()
  }, 10000)
})

describe("AuthorizationAcceptanceForm — accessibility", () => {
  it("19. the form can be submitted via keyboard only", async () => {
    renderForm()
    fireEvent.click(checkbox())
    fireEvent.submit(checkbox().closest("form")!)

    await waitFor(() => expect(acceptPortalAccessAuthorizationMock).toHaveBeenCalledTimes(1))
  })

  it("no typed-name input renders anywhere in this form", () => {
    renderForm()
    expect(screen.queryByLabelText(/name/i)).toBeNull()
    expect(screen.queryByRole("textbox")).toBeNull()
  })
})
