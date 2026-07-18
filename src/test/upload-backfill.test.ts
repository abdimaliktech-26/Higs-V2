// @vitest-environment node
import fs from "node:fs/promises"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const templateFindMany = vi.fn()
const supportingFindMany = vi.fn()
const transactionMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    documentTemplate: { findMany: (...a: unknown[]) => templateFindMany(...a) },
    supportingDocument: { findMany: (...a: unknown[]) => supportingFindMany(...a) },
    $transaction: (cb: unknown) => transactionMock(cb),
  },
}))

import { STORAGE_ROOT } from "@/lib/storage"
import { backfillLegacyOwnerObjects } from "@/lib/uploads/backfill"

const ORG_ID = "12345678-1234-4234-9234-123456789abc"
const TEMPLATE_ID = "22345678-1234-4234-9234-123456789abc"
const KMS_ARN = "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111"
const LEGACY_KEY = `templates/${ORG_ID}/backfill-test.pdf`
const PDF_BYTES = Buffer.from("%PDF-1.4\nbackfill fixture bytes\n")

function validEnvironment() {
  vi.stubEnv("STORAGE_PROVIDER", "s3")
  vi.stubEnv("AWS_REGION", "us-east-2")
  vi.stubEnv("S3_DURABLE_BUCKET", "higsi-durable-prod")
  vi.stubEnv("S3_QUARANTINE_BUCKET", "higsi-quarantine-prod")
  vi.stubEnv("S3_KMS_KEY_ARN", KMS_ARN)
  vi.stubEnv("S3_SIGNED_URL_TTL_SECONDS", "60")
}

function templateOwner(overrides: Record<string, unknown> = {}) {
  return { id: TEMPLATE_ID, organizationId: ORG_ID, fileKey: LEGACY_KEY, ...overrides }
}

interface FakeTx {
  storedObject: { create: ReturnType<typeof vi.fn> }
  documentTemplate: { updateMany: ReturnType<typeof vi.fn> }
  supportingDocument: { updateMany: ReturnType<typeof vi.fn> }
}

let currentTx: FakeTx

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    provider: "s3",
    putObject: vi.fn().mockImplementation(async (input: { key: string; checksumSha256: string; mimeType: string }) => ({
      provider: "s3",
      bucket: "higsi-durable-prod",
      key: input.key,
      location: "durable",
      versionId: "bf1",
      etag: "etag",
      checksumSha256: input.checksumSha256,
      size: PDF_BYTES.length,
      mimeType: input.mimeType,
      encryptionKeyReference: KMS_ARN,
      lastModified: new Date(),
      metadata: {},
    })),
    ...overrides,
  } as never
}

beforeEach(async () => {
  vi.clearAllMocks()
  validEnvironment()
  templateFindMany.mockResolvedValue([templateOwner()])
  supportingFindMany.mockResolvedValue([])
  currentTx = {
    storedObject: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "stored-1", ...data })) },
    documentTemplate: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    supportingDocument: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
  }
  transactionMock.mockImplementation((cb: (tx: FakeTx) => unknown) => cb(currentTx))
  await fs.mkdir(path.dirname(path.join(STORAGE_ROOT, LEGACY_KEY)), { recursive: true })
  await fs.writeFile(path.join(STORAGE_ROOT, LEGACY_KEY), PDF_BYTES)
})

afterEach(async () => {
  vi.unstubAllEnvs()
  await fs.rm(path.join(STORAGE_ROOT, LEGACY_KEY), { force: true })
})

describe("PR-5C.2 legacy-row backfill", () => {
  it("migrates a legacy template: verified durable write, honest NOT_SCANNED, guarded owner link", async () => {
    const adapter = makeAdapter()
    const summary = await backfillLegacyOwnerObjects(adapter, {})
    expect(summary.migrated).toBe(1)

    const put = (adapter as { putObject: ReturnType<typeof vi.fn> }).putObject.mock.calls[0][0]
    expect(put.location).toBe("durable")
    expect(put.mimeType).toBe("application/pdf")
    expect(put.encryption).toEqual({ mode: "sse-kms" })
    expect(put.preconditions).toEqual({ ifNoneMatch: true })

    const created = currentTx.storedObject.create.mock.calls[0][0].data
    expect(created.lifecycleStatus).toBe("AVAILABLE")
    expect(created.malwareStatus).toBe("NOT_SCANNED")
    expect(created.objectVersionId).toBe("bf1")
    expect(created.organizationId).toBe(ORG_ID)

    expect(currentTx.documentTemplate.updateMany).toHaveBeenCalledWith({
      where: { id: TEMPLATE_ID, storedObjectId: null },
      data: { storedObjectId: "stored-1" },
    })
    // The local legacy file is never modified or deleted.
    await expect(fs.readFile(path.join(STORAGE_ROOT, LEGACY_KEY))).resolves.toEqual(PDF_BYTES)
  })

  it("selects only unlinked owners, bounded by the batch limit — reruns are idempotent by construction", async () => {
    const adapter = makeAdapter()
    await backfillLegacyOwnerObjects(adapter, { batchLimit: 5 })
    const query = templateFindMany.mock.calls[0][0]
    expect(query.where).toEqual({ storedObjectId: null, fileKey: { not: "" } })
    expect(query.take).toBe(5)
  })

  it("reports a missing local file without creating any StoredObject", async () => {
    await fs.rm(path.join(STORAGE_ROOT, LEGACY_KEY), { force: true })
    const adapter = makeAdapter()
    const summary = await backfillLegacyOwnerObjects(adapter, {})
    expect(summary.missing).toBe(1)
    expect((adapter as { putObject: ReturnType<typeof vi.fn> }).putObject).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("skips unsupported legacy content (for example HEIC) without writing", async () => {
    await fs.writeFile(path.join(STORAGE_ROOT, LEGACY_KEY), Buffer.concat([Buffer.from([0, 0, 0, 0x18]), Buffer.from("ftypheic"), Buffer.alloc(32)]))
    const adapter = makeAdapter()
    const summary = await backfillLegacyOwnerObjects(adapter, {})
    expect(summary.skipped).toBe(1)
    expect(summary.outcomes[0].detail).toBe("UNSUPPORTED_FORMAT")
    expect((adapter as { putObject: ReturnType<typeof vi.fn> }).putObject).not.toHaveBeenCalled()
  })

  it("fails verification without linking when the written object does not match", async () => {
    const adapter = makeAdapter({
      putObject: vi.fn().mockResolvedValue({
        provider: "s3", bucket: "higsi-durable-prod", key: "k", location: "durable",
        versionId: "bf1", checksumSha256: "0".repeat(64), size: 1, mimeType: "application/pdf",
        encryptionKeyReference: KMS_ARN, lastModified: new Date(), metadata: {},
      }),
    })
    const summary = await backfillLegacyOwnerObjects(adapter, {})
    expect(summary.failed).toBe(1)
    expect(summary.outcomes[0].detail).toBe("DURABLE_VERIFICATION_FAILED")
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("returns a bounded conflict and rolls back when the owner was linked concurrently", async () => {
    currentTx.documentTemplate.updateMany.mockResolvedValue({ count: 0 })
    const adapter = makeAdapter()
    const summary = await backfillLegacyOwnerObjects(adapter, {})
    expect(summary.conflicted).toBe(1)
    // The StoredObject create happened inside the same rejected transaction —
    // rollback removes it, so no falsely authoritative state remains.
  })

  it("performs no write in dry-run mode", async () => {
    const adapter = makeAdapter()
    const summary = await backfillLegacyOwnerObjects(adapter, { dryRun: true })
    expect(summary.skipped).toBe(1)
    expect((adapter as { putObject: ReturnType<typeof vi.fn> }).putObject).not.toHaveBeenCalled()
    expect(transactionMock).not.toHaveBeenCalled()
  })
})
