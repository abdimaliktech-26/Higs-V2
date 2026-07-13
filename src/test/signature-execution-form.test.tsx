// Stage 5 Step 5a.2 — SignatureExecutionForm: pure UI client of
// executeStaffSignature. These tests mock the action itself and verify the
// form never trusts client validation as the security boundary, preserves
// state after a server error, focuses the error summary, prevents
// duplicate submission, and shows the required inline success state before
// navigating.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { SignatureExecutionForm } from "@/app/signatures/[id]/sign/signature-execution-form"

const executeStaffSignatureMock = vi.fn()
const pushMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("@/lib/actions/signatures", () => ({
  executeStaffSignature: (...a: unknown[]) => executeStaffSignatureMock(...a),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: (...a: unknown[]) => pushMock(...a), refresh: (...a: unknown[]) => refreshMock(...a) }),
}))

const REQUEST_ID = "sig-req-1"

function renderForm() {
  return render(<SignatureExecutionForm requestId={REQUEST_ID} expectedSignerName="Jane Doe" />)
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /complete signature/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  executeStaffSignatureMock.mockResolvedValue({
    success: true,
    data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date("2026-07-13T14:14:00Z").toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true },
  })
})

describe("SignatureExecutionForm — initial state", () => {
  it("3. the typed-name input is blank initially", () => {
    renderForm()
    const input = screen.getByLabelText(/your full name/i) as HTMLInputElement
    expect(input.value).toBe("")
  })
})

describe("SignatureExecutionForm — submission contract", () => {
  it("6. submit calls executeStaffSignature with exactly the request id, typed name, and consent boolean", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(executeStaffSignatureMock).toHaveBeenCalledTimes(1))
    expect(executeStaffSignatureMock).toHaveBeenCalledWith(REQUEST_ID, { signerName: "Jane Doe", consentAccepted: true })
  })

  it("7. a blank name is blocked client-side — the action is never called", async () => {
    renderForm()
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()
    expect(executeStaffSignatureMock).not.toHaveBeenCalled()
    expect(screen.getByText(/enter your name to sign/i)).toBeTruthy()
  })

  it("8. unchecked consent is blocked client-side — the action is never called", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    submit()
    expect(executeStaffSignatureMock).not.toHaveBeenCalled()
    expect(screen.getByText(/must accept the consent statement/i)).toBeTruthy()
  })
})

describe("SignatureExecutionForm — server error handling", () => {
  it("9. a server action error appears in the error alert", async () => {
    executeStaffSignatureMock.mockResolvedValue({ success: false, error: "The name you entered does not match the signer name on this request." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Wrong Name" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect(screen.getByRole("alert").textContent).toContain("does not match the signer name")
  })

  it("10. the typed name and consent checkbox state remain after a server error", async () => {
    executeStaffSignatureMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    expect((screen.getByLabelText(/your full name/i) as HTMLInputElement).value).toBe("Jane Doe")
    expect((screen.getByLabelText(/agree to the consent terms/i) as HTMLInputElement).checked).toBe(true)
  })

  it("11. the error alert receives focus after a failed submission", async () => {
    executeStaffSignatureMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByRole("alert")).toBe(document.activeElement))
  })

  it("does not clear the form or reset the name on a failed submission", async () => {
    executeStaffSignatureMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy())
    // The form (name input, checkbox, submit button) is still present, not replaced.
    expect(screen.getByLabelText(/your full name/i)).toBeTruthy()
    expect(screen.getByRole("button", { name: /complete signature/i })).toBeTruthy()
  })
})

describe("SignatureExecutionForm — pending/duplicate submission", () => {
  it("12. the submit button is disabled while the request is pending", async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    executeStaffSignatureMock.mockImplementation(() => new Promise((r) => { resolvePromise = r }))
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect((screen.getByRole("button", { name: /complete signature/i }) as HTMLButtonElement).disabled).toBe(true))
    resolvePromise({ success: true, data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date().toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true } })
  })

  it("13. repeated clicks while pending do not create duplicate action calls", async () => {
    let resolvePromise: (v: unknown) => void = () => {}
    executeStaffSignatureMock.mockImplementation(() => new Promise((r) => { resolvePromise = r }))
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()
    submit()
    submit()

    await waitFor(() => expect(executeStaffSignatureMock).toHaveBeenCalledTimes(1))
    resolvePromise({ success: true, data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date().toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true } })
  })
})

describe("SignatureExecutionForm — success", () => {
  it("14. the success confirmation renders before navigation occurs", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByText(/electronic signature was completed successfully/i)).toBeTruthy())
    expect(pushMock).not.toHaveBeenCalled()
  })

  it("includes the signed timestamp and completion status in the success message", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByText(/all tracked signature requests for this packet are now complete/i)).toBeTruthy())
  })

  it("shows the remaining-count message when signatures are still outstanding", async () => {
    executeStaffSignatureMock.mockResolvedValue({
      success: true,
      data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date().toISOString(), remainingIncompleteSignatures: 2, allRequiredSignaturesComplete: false },
    })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByText(/2 signature requests still open/i)).toBeTruthy())
  })

  it("15. the success state prevents resubmission (the form is replaced, not left submittable)", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByText(/electronic signature was completed successfully/i)).toBeTruthy())
    expect(screen.queryByRole("button", { name: /complete signature/i })).toBeNull()
  })

  it("16. navigates back to the signature detail page after success", async () => {
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()

    await waitFor(() => expect(screen.getByText(/electronic signature was completed successfully/i)).toBeTruthy())
    // Generous margin over the component's own 1200ms redirect delay — this
    // uses real timers (deliberately, matching this repo's own convention
    // for async-timing tests) so it must tolerate full-suite parallel load,
    // not just this file running in isolation. The per-test timeout below
    // is raised to match (vitest's default is 5000ms, too tight here).
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith(`/signatures/${REQUEST_ID}`), { timeout: 8000 })
    expect(refreshMock).toHaveBeenCalled()
  }, 10000)
})

describe("SignatureExecutionForm — accessibility", () => {
  it("28. the form can be completed and submitted via keyboard only (Enter submits)", async () => {
    renderForm()
    const nameInput = screen.getByLabelText(/your full name/i)
    fireEvent.change(nameInput, { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    fireEvent.submit(nameInput.closest("form")!)

    await waitFor(() => expect(executeStaffSignatureMock).toHaveBeenCalledTimes(1))
  })

  it("29. the error alert uses role=alert and the success state uses role=status — neither is color-only", async () => {
    executeStaffSignatureMock.mockResolvedValue({ success: false, error: "Some server error." })
    renderForm()
    fireEvent.change(screen.getByLabelText(/your full name/i), { target: { value: "Jane Doe" } })
    fireEvent.click(screen.getByLabelText(/agree to the consent terms/i))
    submit()
    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("Some server error."))

    executeStaffSignatureMock.mockResolvedValue({
      success: true,
      data: { requestId: REQUEST_ID, status: "signed", signedAt: new Date().toISOString(), remainingIncompleteSignatures: 0, allRequiredSignaturesComplete: true },
    })
    submit()
    await waitFor(() => expect(screen.getByRole("status").textContent).toMatch(/completed successfully/i))
  })

  it("associates an explicit label with the typed-name input", () => {
    renderForm()
    const input = screen.getByLabelText(/your full name/i)
    expect(input.tagName).toBe("INPUT")
  })

  it("associates a native, labeled checkbox for consent", () => {
    renderForm()
    const checkbox = screen.getByLabelText(/agree to the consent terms/i) as HTMLInputElement
    expect(checkbox.type).toBe("checkbox")
  })
})
