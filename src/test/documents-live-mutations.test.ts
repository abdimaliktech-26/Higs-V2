import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const packetDocumentFindUnique = vi.fn()
const packetDocumentUpdate = vi.fn()
const pdfFieldCreate = vi.fn()
const pdfFieldFindUnique = vi.fn()
const pdfFieldUpdate = vi.fn()
const pdfVersionCreate = vi.fn()
const documentCommentCreate = vi.fn()
const requireDocumentAccess = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: {
      findUnique: (...args: unknown[]) => packetDocumentFindUnique(...args),
      update: (...args: unknown[]) => packetDocumentUpdate(...args),
    },
    pdfField: {
      create: (...args: unknown[]) => pdfFieldCreate(...args),
      findUnique: (...args: unknown[]) => pdfFieldFindUnique(...args),
      update: (...args: unknown[]) => pdfFieldUpdate(...args),
    },
    pdfVersion: { create: (...args: unknown[]) => pdfVersionCreate(...args) },
    documentComment: { create: (...args: unknown[]) => documentCommentCreate(...args) },
    $transaction: (cb: (tx: unknown) => unknown) => cb({
      storedObject: { create: vi.fn() },
      pdfVersion: { create: (...args: unknown[]) => pdfVersionCreate(...args) },
      packetDocument: { update: (...args: unknown[]) => packetDocumentUpdate(...args) },
      auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    }),
  },
}))
vi.mock("@/lib/live-authorization", () => ({ requireDocumentAccess: (...args: unknown[]) => requireDocumentAccess(...args) }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("@/lib/storage", () => ({
  signStaffFileUrl: vi.fn(),
  getFileStream: vi.fn(async () => ({
    stream: {
      // Minimal single-page PDF so real fillPdf can run inside the action.
      readFile: async () => {
        const { buildSyntheticPdf } = await import("../../scripts/upload-platform-verify")
        return buildSyntheticPdf(32 * 1024)
      },
      close: async () => undefined,
    },
    mimeType: "application/pdf",
    size: 32 * 1024,
  })),
  storeFile: vi.fn(async (key: string, buffer: Buffer) => ({
    key, url: `/api/files/${key}?direct=1`, size: buffer.length, mimeType: "application/pdf", originalName: "v.pdf",
  })),
}))
vi.mock("@/lib/storage/index", () => ({
  createStorageAdapter: vi.fn(),
  storageKeys: { packetDocumentVersion: vi.fn(() => "organizations/o/documents/d/versions/v.pdf") },
  readStorageConfiguration: vi.fn(() => ({ provider: "local" })),
}))
vi.mock("@/lib/conditions/runtime", () => ({
  reconcilePacketDocumentApplicability: vi.fn(),
  buildPacketConditionContext: vi.fn(async () => ({})),
  buildPacketConditionContextTx: vi.fn(),
  buildEditorDocumentConditionState: vi.fn(() => ({ fieldsById: {} })),
  evaluatePdfFieldVisibility: vi.fn(),
  evaluatePdfFieldRequiredness: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const DOC_ID = "document-1"
const ACTOR_ID = "case-1"

function documentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: DOC_ID, packetId: "packet-1", currentVersion: 0, applicabilityStatus: "ACTIVE",
    packet: { id: "packet-1", organizationId: ORG_ID, status: "in_progress" },
    documentTemplate: { name: "ISP", fileKey: "templates/isp.pdf" },
    packetTemplateDocumentId: "mapping-1",
    fields: [],
    signatureRequests: [],
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  packetDocumentFindUnique.mockResolvedValue(documentRow())
  packetDocumentUpdate.mockResolvedValue({})
  pdfFieldCreate.mockResolvedValue({ id: "field-1" })
  pdfFieldFindUnique.mockResolvedValue({
    id: "field-1", name: "Name", packetDocumentId: DOC_ID,
    packetDocument: documentRow(),
  })
  pdfFieldUpdate.mockResolvedValue({})
  pdfVersionCreate.mockResolvedValue({})
  documentCommentCreate.mockResolvedValue({ id: "comment-1" })
  requireDocumentAccess.mockResolvedValue({ userId: ACTOR_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  createAuditEvent.mockResolvedValue(undefined)
})

describe("remaining document mutations use live resource authorization", () => {
  it("authorizes a new field through the owning document", async () => {
    const { addPdfField } = await import("@/lib/actions/documents")
    const result = await addPdfField({ packetDocumentId: DOC_ID, name: "Name", fieldType: "text", pageNumber: 1 })
    expect(result.success).toBe(true)
    expect(requireDocumentAccess).toHaveBeenCalledWith(DOC_ID, "write", "add document field")
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: ACTOR_ID }))
  })

  it("rejects adding a field after live access is revoked", async () => {
    requireDocumentAccess.mockRejectedValue(new Error("Access denied"))
    const { addPdfField } = await import("@/lib/actions/documents")
    const result = await addPdfField({ packetDocumentId: DOC_ID, name: "Name", fieldType: "text", pageNumber: 1 })
    expect(result).toEqual({ success: false, error: "Access denied" })
    expect(pdfFieldCreate).not.toHaveBeenCalled()
  })

  it.each([
    { applicabilityStatus: "CONDITIONALLY_INACTIVE" },
    { packet: { id: "packet-1", organizationId: ORG_ID, status: "approved" } },
    { packet: { id: "packet-1", organizationId: ORG_ID, status: "archived" } },
  ])("rejects adding a field to a locked document", async (overrides) => {
    packetDocumentFindUnique.mockResolvedValue(documentRow(overrides))
    const { addPdfField } = await import("@/lib/actions/documents")
    const result = await addPdfField({ packetDocumentId: DOC_ID, name: "Name", fieldType: "text", pageNumber: 1 })
    expect(result).toEqual({ success: false, error: "This document is locked for editing" })
    expect(pdfFieldCreate).not.toHaveBeenCalled()
  })

  it("derives field updates from the field's parent document", async () => {
    const { updatePdfField } = await import("@/lib/actions/documents")
    const result = await updatePdfField("field-1", { value: "updated" })
    expect(result.success).toBe(true)
    expect(requireDocumentAccess).toHaveBeenCalledWith(DOC_ID, "write", "update document field")
  })

  it("does not update fields in an approved packet", async () => {
    pdfFieldFindUnique.mockResolvedValue({
      id: "field-1", name: "Name", packetDocumentId: DOC_ID,
      packetDocument: documentRow({ packet: { id: "packet-1", organizationId: ORG_ID, status: "approved" } }),
    })
    const { updatePdfField } = await import("@/lib/actions/documents")
    await expect(updatePdfField("field-1", { value: "updated" })).resolves.toEqual({ success: false, error: "This document is locked for editing" })
    expect(pdfFieldUpdate).not.toHaveBeenCalled()
  })

  it("uses the live actor when creating a PDF version", async () => {
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion(DOC_ID, "checkpoint")
    expect(result.success).toBe(true)
    expect(requireDocumentAccess).toHaveBeenCalledWith(DOC_ID, "write", "create document version")
    expect(pdfVersionCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: ACTOR_ID }) })
  })

  it("blocks PDF-version creation on a locked packet", async () => {
    packetDocumentFindUnique.mockResolvedValue(documentRow({ packet: { id: "packet-1", organizationId: ORG_ID, status: "archived" } }))
    const { createPdfVersion } = await import("@/lib/actions/documents")
    await expect(createPdfVersion(DOC_ID)).resolves.toEqual({ success: false, error: "This document is locked for editing" })
    expect(pdfVersionCreate).not.toHaveBeenCalled()
  })

  it("uses live document write access and actor identity for comments", async () => {
    const { addDocumentComment } = await import("@/lib/actions/documents")
    const result = await addDocumentComment(DOC_ID, "Review note")
    expect(result.success).toBe(true)
    expect(requireDocumentAccess).toHaveBeenCalledWith(DOC_ID, "write", "add document comment")
    expect(documentCommentCreate).toHaveBeenCalledWith({ data: expect.objectContaining({ createdById: ACTOR_ID }) })
  })
})
