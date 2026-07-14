// Stage 5 Step 5c.1 — RequestSignatureModal: pure UI client of
// createSignatureRequest. Verifies staff must deliberately select a field
// (and, for a portal signer, a grant), the STAFF/PORTAL toggle only
// appears when an eligible grant exists, and the exact discriminated
// payload sent for each assignment type — no free-typed portal-user id,
// contact id, or signer identity is ever included in a PORTAL submission.
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, screen, fireEvent, waitFor } from "@testing-library/react"
import { RequestSignatureModal } from "@/app/packets/[id]/request-signature-modal"

const createSignatureRequestMock = vi.fn()
const refreshMock = vi.fn()

vi.mock("@/lib/actions/signatures", () => ({
  createSignatureRequest: (...a: unknown[]) => createSignatureRequestMock(...a),
}))
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: (...a: unknown[]) => refreshMock(...a) }),
}))

const PACKET_ID = "packet-0000001"

const ONE_FIELD = [{ id: "field-1", packetDocumentId: "doc-1", name: "Guardian Signature", pageNumber: 1, isRequired: true, documentName: "ISP" }]
const TWO_FIELDS = [
  ...ONE_FIELD,
  { id: "field-2", packetDocumentId: "doc-1", name: "Client Signature", pageNumber: 2, isRequired: true, documentName: "ISP" },
]
const ONE_GRANT = [{ accessGrantId: "grant-1", portalUserId: "portal-user-1", email: "guardian@example.com", contactName: "Jane Doe", relationship: "Mother", accessRole: "GUARDIAN" }]

function renderModal(props: Partial<React.ComponentProps<typeof RequestSignatureModal>> = {}) {
  return render(
    <RequestSignatureModal
      packetId={PACKET_ID}
      defaultSignerName="Ayaan Mohamed"
      defaultSignerEmail="ayaan@example.com"
      eligibleFields={TWO_FIELDS}
      eligibleGrants={[]}
      {...props}
    />
  )
}

beforeEach(() => {
  vi.clearAllMocks()
  createSignatureRequestMock.mockResolvedValue({ success: true, data: { id: "sig-req-new" } })
})

describe("RequestSignatureModal — availability", () => {
  it("the trigger button is disabled when there are no eligible fields", () => {
    renderModal({ eligibleFields: [] })
    expect((screen.getByRole("button", { name: /request signature/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it("opens the modal on click when eligible fields exist", () => {
    renderModal()
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    expect(screen.getByRole("heading", { name: /request signature/i })).toBeTruthy()
  })

  it("does not render the STAFF/PORTAL toggle when there are no eligible grants, and explains why", () => {
    renderModal({ eligibleGrants: [] })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    expect(screen.queryByText("Portal user")).toBeNull()
    expect(screen.getByText(/no portal signers are currently eligible/i)).toBeTruthy()
  })

  it("renders the STAFF/PORTAL toggle when at least one eligible grant exists", () => {
    renderModal({ eligibleGrants: ONE_GRANT })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    expect(screen.getByText("Portal user")).toBeTruthy()
  })
})

describe("RequestSignatureModal — staff assignment", () => {
  it("submits the exact STAFF discriminated payload with the selected field split into packetDocumentId/pdfFieldId", async () => {
    renderModal({ eligibleFields: ONE_FIELD })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    fireEvent.change(screen.getByLabelText(/consent text/i), { target: { value: "Consent text here." } })
    fireEvent.click(screen.getByRole("button", { name: /create request/i }))

    await waitFor(() => expect(createSignatureRequestMock).toHaveBeenCalledTimes(1))
    expect(createSignatureRequestMock).toHaveBeenCalledWith(expect.objectContaining({
      assignmentType: "STAFF",
      packetId: PACKET_ID,
      packetDocumentId: "doc-1",
      pdfFieldId: "field-1",
      consentText: "Consent text here.",
      signerName: "Ayaan Mohamed",
      signerEmail: "ayaan@example.com",
    }))
  })

  it("does not include accessGrantId in a STAFF submission", async () => {
    renderModal({ eligibleFields: ONE_FIELD })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    fireEvent.change(screen.getByLabelText(/consent text/i), { target: { value: "Consent text here." } })
    fireEvent.click(screen.getByRole("button", { name: /create request/i }))

    await waitFor(() => expect(createSignatureRequestMock).toHaveBeenCalledTimes(1))
    expect(createSignatureRequestMock.mock.calls[0][0]).not.toHaveProperty("accessGrantId")
  })

  it("closes the modal and refreshes after a successful submission", async () => {
    renderModal({ eligibleFields: ONE_FIELD })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    fireEvent.change(screen.getByLabelText(/consent text/i), { target: { value: "Consent text here." } })
    fireEvent.click(screen.getByRole("button", { name: /create request/i }))

    await waitFor(() => expect(refreshMock).toHaveBeenCalled())
    expect(screen.queryByRole("heading", { name: /request signature/i })).toBeNull()
  })

  it("shows the server error and keeps the modal open on failure", async () => {
    createSignatureRequestMock.mockResolvedValue({ success: false, error: "This signature field already has an open signature request." })
    renderModal({ eligibleFields: ONE_FIELD })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    fireEvent.change(screen.getByLabelText(/consent text/i), { target: { value: "Consent text here." } })
    fireEvent.click(screen.getByRole("button", { name: /create request/i }))

    await waitFor(() => expect(screen.getByRole("alert").textContent).toContain("already has an open signature request"))
    expect(screen.getByRole("heading", { name: /request signature/i })).toBeTruthy()
  })
})

describe("RequestSignatureModal — portal assignment", () => {
  it("submits the exact PORTAL discriminated payload — only accessGrantId identifies the signer", async () => {
    renderModal({ eligibleFields: ONE_FIELD, eligibleGrants: ONE_GRANT })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    fireEvent.click(screen.getByLabelText("Portal user"))
    fireEvent.change(screen.getByLabelText(/consent text/i), { target: { value: "Consent text here." } })
    fireEvent.click(screen.getByRole("button", { name: /create request/i }))

    await waitFor(() => expect(createSignatureRequestMock).toHaveBeenCalledTimes(1))
    const payload = createSignatureRequestMock.mock.calls[0][0]
    expect(payload).toEqual(expect.objectContaining({
      assignmentType: "PORTAL",
      packetId: PACKET_ID,
      packetDocumentId: "doc-1",
      pdfFieldId: "field-1",
      consentText: "Consent text here.",
      accessGrantId: "grant-1",
    }))
    expect(payload).not.toHaveProperty("signerName")
    expect(payload).not.toHaveProperty("signerEmail")
  })

  it("switching back to STAFF hides the portal-signer select", async () => {
    renderModal({ eligibleFields: ONE_FIELD, eligibleGrants: ONE_GRANT })
    fireEvent.click(screen.getByRole("button", { name: /request signature/i }))
    fireEvent.click(screen.getByLabelText("Portal user"))
    expect(screen.getByLabelText(/portal signer/i)).toBeTruthy()
    fireEvent.click(screen.getByLabelText(/staff \/ external signer/i))
    expect(screen.queryByLabelText(/portal signer/i)).toBeNull()
  })
})
