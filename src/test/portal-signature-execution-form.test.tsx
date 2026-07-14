// Stage 5 Step 5c.3 — the portal SignatureExecutionForm: pure UI client of
// executePortalSignature. Mirrors the staff form's test conventions
// exactly (signature-execution-form.test.tsx) — mocks the action itself,
// verifies client-side validation is never the security boundary, and the
// accessible success/error handling required for this step.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SignatureExecutionForm } from "@/app/portal/(app)/signatures/[id]/sign/signature-execution-form"

const executePortalSignatureMock = vi.fn()
const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("@/lib/actions/signatures", () => ({
  executePortalSignature: (...a: unknown[]) => executePortalSignatureMock(...a),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => pushMock(...a), refresh: (...a: unknown[]) => refreshMock(...a) }),
}))

const REQUEST_ID = "sig-req-1"
const CLIENT_ID = "client-1"

function renderForm() {
  return render(<SignatureExecutionForm requestId={REQUEST_ID} clientId={CLIENT_ID} expectedSignerName="Jane Doe" />)
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /complete signature/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  executePortalSignatureMock.mockResolvedValue({
    success: true,
    data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date("2026-07-14T14:14:00Z").toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true },
  })
})

describe("SignatureExecutionForm (portal) — initial state", () => {
  it("the typed-name input is blank initially", () => {
    renderForm()
    expect((screen.getByLabelText(/your full name/i) as HTMLInputElement).value).toBe("")
  })
})

describe("SignatureExecutionForm (portal) — submission contract", () => {
  it("submit calls executePortalSignature with exactly the request id, typed name, and consent boolean", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(executePortalSignatureMock).toHaveBeenCalledTimes(1))
    expect(executePortalSignatureMock).toHaveBeenCalledWith(REQUEST_ID, { signerName: "Jane Doe", consentAccepted: true })
  })

  it("a blank name is blocked client-side — the action is never called", async () => {
    renderForm()
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()
    expect(executePortalSignatureMock).not.toHaveBeenCalled()
    expect(screen.getByText(/enter your name to sign/i)).toBeTruthy()
  })

  it("unchecked consent is blocked client-side — the action is never called", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    submit()
    expect(executePortalSignatureMock).not.toHaveBeenCalled()
    expect(screen.getByText(/must accept the consent statement/i)).toBeTruthy()
  })
})

describe("SignatureExecutionForm (portal) — server error handling", () => {
  it("a server action error appears in the error alert", async () => {
    executePortalSignatureMock.mockResolvedValue({ success: false, error: "The name you entered does not match the signer name on this request." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Wrong Name" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(screen.getByRole("alert").textContent).toContain("does not match the signer name")
  })

  it("the typed name and consent checkbox state remain after a server error", async () => {
    executePortalSignatureMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect((screen.getByLabelText(/your full name/i) as HTMLInputElement).value).toBe("Jane Doe")
    expect((screen.getByLabelText(/agree to the consent terms/i) as HTMLInputElement).checked).toBe(true)
  })

  it("the error alert receives focus after a failed submission", async () => {
    executePortalSignatureMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBe(document.activeElement), { timeout: 5000 })
  }, 7000)
})

describe("SignatureExecutionForm (portal) — pending/duplicate submission", () => {
  it("the submit button is disabled while the request is pending", async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    executePortalSignatureMock.mockImplementation(() => new Promise((r) => { resolvePromise = r }))
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect((screen.getByRole("button", { name: /complete signature/i }) as HTMLButtonElement).disabled).toBe(true))
    resolvePromise({ success: true, data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date().toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true } })
  })

  it("repeated clicks while pending do not create duplicate action calls", async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    executePortalSignatureMock.mockImplementation(() => new Promise((r) => { resolvePromise = r }))
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()
    submit()
    submit()

    await waitFor(() => expect(executePortalSignatureMock).toHaveBeenCalledTimes(1))
    resolvePromise({ success: true, data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date().toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true } })
  })
})

describe("SignatureExecutionForm (portal) — success", () => {
  it("the success confirmation renders in a role=status region before navigation", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/completed successfully/i))
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("the success state prevents resubmission", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy())
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
  })

  it("navigates back to the portal dashboard for the current client after success", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("status")).toBeTruthy())
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/portal/dashboard?client=${CLIENT_ID}`), { timeout: 8000 })
    expect(refreshMock).toHaveBeenCalled()
  }, 10000)
})

describe("SignatureExecutionForm (portal) — accessibility", () => {
  it("the form can be completed and submitted via keyboard only", async () => {
    renderForm()
    const nameInput = screen.getByLabelText(/your full name/i)
    fireEvent.change(nameInput, { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    fireEvent.submit(nameInput.closest("form")!)

    await waitFor(() => expect(executePortalSignatureMock).toHaveBeenCalledTimes(1))
  })

  it("associates an explicit label with the typed-name input and a native labeled checkbox for consent", () => {
    renderForm()
    expect(screen.getByLabelText(/your full name/i).tagName).toBe("INPUT")
    expect((screen.getByLabelText(/agree to the consent terms/i) as HTMLInputElement).type).toBe("checkbox")
  })
})
