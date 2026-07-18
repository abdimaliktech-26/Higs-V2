// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { buildSyntheticPdf } from "../../scripts/upload-platform-verify"

const findDocMock = vi.fn()
const versionCreateMock = vi.fn()
const docUpdateMock = vi.fn()
const requireAccessMock = vi.fn()
const getFileStreamMock = vi.fn()
const storeFileMock = vi.fn()
const auditMock = vi.fn()
const runtimeMock = vi.fn()
const editorStateMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: { findUnique: (...a: unknown[]) => findDocMock(...a), update: (...a: unknown[]) => docUpdateMock(...a) },
    pdfVersion: { create: (...a: unknown[]) => versionCreateMock(...a) },
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  requireDocumentAccess: (...a: unknown[]) => requireAccessMock(...a),
  StaffAuthorizationError: class extends Error {},
}))
vi.mock("@/lib/storage", () => ({
  getFileStream: (...a: unknown[]) => getFileStreamMock(...a),
  storeFile: (...a: unknown[]) => storeFileMock(...a),
  signStaffFileUrl: vi.fn(() => "/signed"),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...a: unknown[]) => auditMock(...a) }))
vi.mock("@/lib/conditions/runtime", () => ({
  buildPacketConditionContext: (...a: unknown[]) => runtimeMock(...a),
  buildPacketConditionContextTx: vi.fn(),
  buildEditorDocumentConditionState: (...a: unknown[]) => editorStateMock(...a),
  reconcilePacketDocumentApplicability: vi.fn(),
  evaluatePdfFieldVisibility: vi.fn(),
  evaluatePdfFieldRequiredness: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("@/lib/validation", async (importOriginal) => importOriginal())

const BASE = 1.5

function pdfField(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    templateFieldKey: id,
    name: id,
    fieldType: "text",
    value: "Filled value",
    pageNumber: 1,
    posX: 80 * BASE,
    posY: 300 * BASE,
    width: 180 * BASE,
    height: 14 * BASE,
    isRequired: false,
    sortOrder: 0,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  requireAccessMock.mockResolvedValue({ userId: "staff-1", organizationId: "org-1" })
  runtimeMock.mockResolvedValue({})
  editorStateMock.mockReturnValue({
    fieldsById: {
      "visible-field": { isVisible: true },
      "hidden-field": { isVisible: false },
    },
  })
  const template = buildSyntheticPdf(64 * 1024)
  getFileStreamMock.mockResolvedValue({
    stream: { readFile: async () => template, close: async () => undefined },
    mimeType: "application/pdf",
    size: template.length,
  })
  storeFileMock.mockImplementation(async (key: string, buffer: Buffer) => ({
    key,
    url: `/api/files/${key}?direct=1`,
    size: buffer.length,
    mimeType: "application/pdf",
    originalName: "v.pdf",
  }))
  versionCreateMock.mockResolvedValue({ id: "version-1" })
  docUpdateMock.mockResolvedValue({})
  findDocMock.mockResolvedValue({
    id: "doc-1",
    packetId: "packet-1",
    packetTemplateDocumentId: "mapping-1",
    applicabilityStatus: "ACTIVE",
    currentVersion: 0,
    packet: { status: "in_progress", organizationId: "org-1" },
    documentTemplate: { name: "Intake — DPF-004 Admission Form and Data Sheet", fileKey: "templates/245d/intake/dpf-004.pdf" },
    fields: [pdfField("visible-field"), pdfField("hidden-field", { value: "Must not render" })],
    signatureRequests: [],
  })
})

describe("createPdfVersion real generation", () => {
  it("renders visible values onto the blank template and stores a real version file", async () => {
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1", "First full version")
    expect(result.success).toBe(true)

    expect(getFileStreamMock).toHaveBeenCalledWith("templates/245d/intake/dpf-004.pdf")
    const [storedKey, storedBuffer] = storeFileMock.mock.calls[0]
    expect(storedKey).toBe("documents/doc-1/v1.pdf")
    expect(Buffer.isBuffer(storedBuffer)).toBe(true)
    expect(storedBuffer.subarray(0, 5).toString()).toBe("%PDF-")

    const versionData = versionCreateMock.mock.calls[0][0].data
    expect(versionData.fileKey).toBe("documents/doc-1/v1.pdf")
    expect(versionData.fileUrl).not.toContain("storage.higsi.com")
    expect(versionData.fileSize).toBe(storedBuffer.length)
    expect(docUpdateMock).toHaveBeenCalledWith({ where: { id: "doc-1" }, data: { currentVersion: 1 } })
    expect(auditMock).toHaveBeenCalledWith(expect.objectContaining({ action: "PDF_VERSION_CREATED" }))
  })

  it("excludes condition-hidden fields from the rendered output", async () => {
    const { createPdfVersion } = await import("@/lib/actions/documents")
    await createPdfVersion("doc-1")
    const buffer: Buffer = storeFileMock.mock.calls[0][1]

    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
    const task = getDocument({ data: new Uint8Array(buffer), useWorkerFetch: false })
    const rendered = await task.promise
    const content = await (await rendered.getPage(1)).getTextContent()
    const text = (content.items as { str: string }[]).map((item) => item.str).join(" ")
    expect(text).toContain("Filled value")
    expect(text).not.toContain("Must not render")
  })

  it("refuses locked documents without touching storage", async () => {
    findDocMock.mockResolvedValue({
      ...(await findDocMock()),
      packet: { status: "approved", organizationId: "org-1" },
    })
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    expect(result.success).toBe(false)
    expect(storeFileMock).not.toHaveBeenCalled()
  })

  it("fails cleanly when the blank template file is unavailable", async () => {
    getFileStreamMock.mockResolvedValue(null)
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    expect(result).toEqual({ success: false, error: "The blank template file is unavailable" })
    expect(versionCreateMock).not.toHaveBeenCalled()
  })
})
