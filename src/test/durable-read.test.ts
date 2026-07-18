// @vitest-environment node
import { Readable } from "node:stream"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const storedObjectFindUnique = vi.fn()
const getObjectStream = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: { storedObject: { findUnique: (...a: unknown[]) => storedObjectFindUnique(...a) } },
}))
vi.mock("@/lib/storage/index", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage/index")>()
  return {
    ...actual,
    createStorageAdapter: () => ({ provider: "s3", getObjectStream: (...a: unknown[]) => getObjectStream(...a) }),
  }
})

import { DurableReadUnavailableError, openAuthoritativeFileSource } from "@/lib/uploads/durable-read"

const ORG_ID = "cm12345678901234567890123"
const OBJECT_ID = "cm72345678901234567890123"

function validEnvironment() {
  vi.stubEnv("STORAGE_PROVIDER", "s3")
  vi.stubEnv("AWS_REGION", "us-east-2")
  vi.stubEnv("S3_DURABLE_BUCKET", "higsi-durable-prod")
  vi.stubEnv("S3_QUARANTINE_BUCKET", "higsi-quarantine-prod")
  vi.stubEnv("S3_KMS_KEY_ARN", "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111")
  vi.stubEnv("S3_SIGNED_URL_TTL_SECONDS", "60")
}

function storedObject(overrides: Record<string, unknown> = {}) {
  return {
    id: OBJECT_ID,
    organizationId: ORG_ID,
    provider: "S3",
    bucket: "higsi-durable-prod",
    objectKey: `organizations/${ORG_ID}/supporting/a/b`,
    objectVersionId: "dv1",
    lifecycleStatus: "AVAILABLE",
    malwareStatus: "CLEAN",
    mimeType: "application/pdf",
    sizeBytes: BigInt(1234),
    ...overrides,
  }
}

function read(overrides: Record<string, unknown> = {}) {
  return openAuthoritativeFileSource({
    organizationId: ORG_ID,
    storedObjectId: OBJECT_ID,
    legacyFileKey: null,
    ...overrides,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  validEnvironment()
  storedObjectFindUnique.mockResolvedValue(storedObject())
  getObjectStream.mockResolvedValue({ stream: Readable.from(Buffer.from("bytes")), metadata: {} })
})

afterEach(() => vi.unstubAllEnvs())

describe("PR-5C.1 durable read qualification", () => {
  it("streams the exact recorded object version with verified metadata", async () => {
    const source = await read()
    expect(source).toMatchObject({ mimeType: "application/pdf", size: 1234, source: "durable" })
    expect(getObjectStream).toHaveBeenCalledWith({
      key: `organizations/${ORG_ID}/supporting/a/b`,
      location: "durable",
      versionId: "dv1",
    })
  })

  it("serves NOT_SCANNED backfilled objects but never PENDING, INFECTED, or ERROR", async () => {
    storedObjectFindUnique.mockResolvedValue(storedObject({ malwareStatus: "NOT_SCANNED" }))
    await expect(read()).resolves.toMatchObject({ source: "durable" })
    for (const malwareStatus of ["PENDING", "INFECTED", "ERROR"]) {
      storedObjectFindUnique.mockResolvedValue(storedObject({ malwareStatus }))
      await expect(read()).resolves.toBeNull()
    }
  })

  it("refuses non-AVAILABLE lifecycles and versionless or non-S3 objects", async () => {
    for (const overrides of [
      { lifecycleStatus: "PENDING" },
      { lifecycleStatus: "FAILED" },
      { lifecycleStatus: "DELETED" },
      { objectVersionId: null },
      { provider: "LOCAL" },
    ]) {
      storedObjectFindUnique.mockResolvedValue(storedObject(overrides))
      await expect(read()).resolves.toBeNull()
    }
    expect(getObjectStream).not.toHaveBeenCalled()
  })

  it("rejects cross-organization StoredObject linkage", async () => {
    storedObjectFindUnique.mockResolvedValue(storedObject({ organizationId: "cm99345678901234567890123" }))
    await expect(read()).resolves.toBeNull()
    expect(getObjectStream).not.toHaveBeenCalled()
  })

  it("returns a bounded unavailable error when the deployment cannot reach the recorded bucket", async () => {
    storedObjectFindUnique.mockResolvedValue(storedObject({ bucket: "some-older-bucket" }))
    await expect(read()).rejects.toBeInstanceOf(DurableReadUnavailableError)
  })

  it("returns a bounded unavailable error when storage is not configured for S3", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "local")
    await expect(read()).rejects.toBeInstanceOf(DurableReadUnavailableError)
  })

  it("maps S3 fetch failures to the bounded unavailable error, never a legacy fallback", async () => {
    getObjectStream.mockRejectedValue(new Error("s3 down"))
    await expect(read({ legacyFileKey: "supporting/legacy.pdf" })).rejects.toBeInstanceOf(DurableReadUnavailableError)
  })

  it("never reads the quarantine location", async () => {
    await read()
    expect(getObjectStream.mock.calls.every((call) => call[0].location === "durable")).toBe(true)
  })

  it("rejects traversal in legacy keys and returns null for missing rows", async () => {
    await expect(read({ storedObjectId: null, legacyFileKey: "../../etc/passwd" })).resolves.toBeNull()
    await expect(read({ storedObjectId: null, legacyFileKey: null })).resolves.toBeNull()
  })
})
