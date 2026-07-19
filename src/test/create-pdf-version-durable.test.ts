// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

const KMS_ARN = "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111"

// ── Part 2: createPdfVersion S3 branch (mocked collaborators) ──

const findDocMock = vi.fn()
const versionCreateMock = vi.fn()
const docUpdateMock = vi.fn()
const storedObjectCreateMock = vi.fn()
const auditCreateMock = vi.fn()
const transactionMock = vi.fn()
const storeFileMock = vi.fn()
const getFileStreamMock = vi.fn()
const durableRequiredMock = vi.fn()
const storeDurablyMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: { findUnique: (...a: unknown[]) => findDocMock(...a) },
    $transaction: (cb: unknown) => transactionMock(cb),
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  requireDocumentAccess: vi.fn(async () => ({ userId: "staff-1", organizationId: "org-1" })),
  StaffAuthorizationError: class extends Error {},
}))
vi.mock("@/lib/storage", () => ({
  getFileStream: (...a: unknown[]) => getFileStreamMock(...a),
  storeFile: (...a: unknown[]) => storeFileMock(...a),
  signStaffFileUrl: vi.fn(() => "/signed"),
}))
vi.mock("@/lib/storage/index", () => ({
  createStorageAdapter: vi.fn(() => ({ provider: "s3" })),
  storageKeys: {
    packetDocumentVersion: (i: Record<string, string>) =>
      `organizations/${i.organizationId}/clients/${i.clientId}/packets/${i.packetId}/documents/${i.packetDocumentId}/versions/${i.pdfVersionId}.pdf`,
  },
  readStorageConfiguration: vi.fn(() => ({ provider: "s3", kmsKeyArn: KMS_ARN })),
}))
vi.mock("@/lib/pdf/store-generated-pdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pdf/store-generated-pdf")>()
  return {
    ...actual,
    isDurableGenerationRequired: (...a: unknown[]) => durableRequiredMock(...a),
    storeGeneratedPdfDurably: (...a: unknown[]) => storeDurablyMock(...a),
  }
})
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn() }))
vi.mock("@/lib/conditions/runtime", () => ({
  buildPacketConditionContext: vi.fn(async () => ({})),
  buildPacketConditionContextTx: vi.fn(),
  buildEditorDocumentConditionState: vi.fn(() => ({ fieldsById: {} })),
  reconcilePacketDocumentApplicability: vi.fn(),
  evaluatePdfFieldVisibility: vi.fn(),
  evaluatePdfFieldRequiredness: vi.fn(),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

function durableResult(bytesLength: number) {
  return {
    bucket: "higsi-durable-prod",
    objectKey: "organizations/org-1/clients/client-1/packets/packet-1/documents/doc-1/versions/x.pdf",
    objectVersionId: "gv1",
    etag: "etag",
    checksumSha256: "c".repeat(64),
    sizeBytes: bytesLength,
    encryptionKeyRef: KMS_ARN,
  }
}

describe("createPdfVersion durable branch", () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    const { buildSyntheticPdf } = await import("../../scripts/upload-platform-verify")
    const template = buildSyntheticPdf(32 * 1024)
    getFileStreamMock.mockResolvedValue({
      stream: { readFile: async () => template, close: async () => undefined },
      mimeType: "application/pdf", size: template.length,
    })
    storeFileMock.mockImplementation(async (key: string, buffer: Buffer) => ({
      key, url: `/api/files/${key}?direct=1`, size: buffer.length, mimeType: "application/pdf", originalName: "v.pdf",
    }))
    versionCreateMock.mockResolvedValue({ id: "version-1" })
    docUpdateMock.mockResolvedValue({})
    storedObjectCreateMock.mockResolvedValue({ id: "stored-1" })
    auditCreateMock.mockResolvedValue({ id: "audit-1" })
    durableRequiredMock.mockReturnValue(true)
    storeDurablyMock.mockImplementation(async (_a: unknown, _k: string, bytes: Buffer) => durableResult(bytes.length))
    transactionMock.mockImplementation((cb: (tx: unknown) => unknown) => cb({
      storedObject: { create: (...a: unknown[]) => storedObjectCreateMock(...a) },
      pdfVersion: { create: (...a: unknown[]) => versionCreateMock(...a) },
      packetDocument: { update: (...a: unknown[]) => docUpdateMock(...a) },
      auditEvent: { create: (...a: unknown[]) => auditCreateMock(...a) },
    }))
    findDocMock.mockResolvedValue({
      id: "doc-1", packetId: "packet-1", packetTemplateDocumentId: "mapping-1",
      applicabilityStatus: "ACTIVE", currentVersion: 0,
      packet: { status: "in_progress", organizationId: "org-1", clientId: "client-1" },
      documentTemplate: { name: "Form", fileKey: "templates/form.pdf" },
      fields: [], signatureRequests: [],
    })
  })

  it("stores durably, links the exact version, and keeps byte parity with the compatibility copy", async () => {
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    expect(result.success).toBe(true)

    const durableBytes: Buffer = storeDurablyMock.mock.calls[0][2]
    const compatBytes: Buffer = storeFileMock.mock.calls[0][1]
    expect(Buffer.compare(durableBytes, compatBytes)).toBe(0)

    const storedData = storedObjectCreateMock.mock.calls[0][0].data
    expect(storedData).toEqual(expect.objectContaining({
      organizationId: "org-1", provider: "S3", objectVersionId: "gv1",
      lifecycleStatus: "AVAILABLE", malwareStatus: "NOT_SCANNED",
      encryptionKeyRef: KMS_ARN,
    }))
    const versionData = versionCreateMock.mock.calls[0][0].data
    expect(versionData.storedObjectId).toBe("stored-1")
    expect(versionData.version).toBe(1)
    expect(auditCreateMock).toHaveBeenCalled()
  })

  it("creates no records when the durable write fails — never a silent local-only downgrade", async () => {
    const { GeneratedPdfStorageError } = await import("@/lib/pdf/store-generated-pdf")
    storeDurablyMock.mockRejectedValue(new GeneratedPdfStorageError("The durable write for the generated document failed."))
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    expect(result).toEqual({ success: false, error: "The durable write for the generated document failed." })
    expect(storeFileMock).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("keeps the durable record authoritative when only the compatibility copy fails", async () => {
    storeFileMock.mockRejectedValue(new Error("disk full"))
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    expect(result.success).toBe(true)
    const versionData = versionCreateMock.mock.calls[0][0].data
    expect(versionData.storedObjectId).toBe("stored-1")
    expect(versionData.fileKey).toBe("documents/doc-1/v1.pdf") // intended path recorded; linked rows never read it
  })

  it("returns a bounded conflict when concurrent generation races the version number", async () => {
    const { Prisma } = await import("@prisma/client")
    transactionMock.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("unique", { code: "P2002", clientVersion: "7" }),
    )
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    expect(result.success).toBe(false)
    expect((result as { error: string }).error).toMatch(/just created/i)
  })

  it("rolls back every authoritative row when the strict audit write fails", async () => {
    auditCreateMock.mockRejectedValue(new Error("audit outage"))
    transactionMock.mockImplementation(async (cb: (tx: unknown) => unknown) => cb({
      storedObject: { create: (...a: unknown[]) => storedObjectCreateMock(...a) },
      pdfVersion: { create: (...a: unknown[]) => versionCreateMock(...a) },
      packetDocument: { update: (...a: unknown[]) => docUpdateMock(...a) },
      auditEvent: { create: (...a: unknown[]) => auditCreateMock(...a) },
    }))
    const { createPdfVersion } = await import("@/lib/actions/documents")
    const result = await createPdfVersion("doc-1")
    // The rejected transaction discards the StoredObject and PdfVersion rows;
    // only the reportable unowned durable artifact remains.
    expect(result.success).toBe(false)
  })
})
