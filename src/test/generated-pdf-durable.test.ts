// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// ── Part 1: verified durable write (real implementation, fake adapter) ──

const KMS_ARN = "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111"

function validEnvironment() {
  vi.stubEnv("STORAGE_PROVIDER", "s3")
  vi.stubEnv("AWS_REGION", "us-east-2")
  vi.stubEnv("S3_DURABLE_BUCKET", "higsi-durable-prod")
  vi.stubEnv("S3_QUARANTINE_BUCKET", "higsi-quarantine-prod")
  vi.stubEnv("S3_KMS_KEY_ARN", KMS_ARN)
  vi.stubEnv("S3_SIGNED_URL_TTL_SECONDS", "60")
}

describe("storeGeneratedPdfDurably verification", () => {
  afterEach(() => vi.unstubAllEnvs())

  function adapterReturning(overrides: Record<string, unknown> = {}) {
    return {
      provider: "s3",
      putObject: vi.fn().mockImplementation(async (input: { key: string; checksumSha256: string }) => ({
        provider: "s3", bucket: "higsi-durable-prod", key: input.key, location: "durable",
        versionId: "gv1", etag: "etag", checksumSha256: input.checksumSha256,
        size: 5, mimeType: "application/pdf", encryptionKeyReference: KMS_ARN,
        lastModified: new Date(), metadata: {},
        ...overrides,
      })),
    } as never
  }

  it("writes with SSE-KMS and no-overwrite preconditions and returns the exact version", async () => {
    validEnvironment()
    const { storeGeneratedPdfDurably } = await import("@/lib/pdf/store-generated-pdf")
    const adapter = adapterReturning()
    const result = await storeGeneratedPdfDurably(adapter, "organizations/o/documents/d/versions/v.pdf", Buffer.from("bytes"))
    const put = (adapter as { putObject: ReturnType<typeof vi.fn> }).putObject.mock.calls[0][0]
    expect(put.encryption).toEqual({ mode: "sse-kms" })
    expect(put.preconditions).toEqual({ ifNoneMatch: true })
    expect(put.location).toBe("durable")
    expect(result.objectVersionId).toBe("gv1")
    expect(result.encryptionKeyRef).toBe(KMS_ARN)
  })

  it.each([
    ["checksum", { checksumSha256: "0".repeat(64) }],
    ["size", { size: 999 }],
    ["mime", { mimeType: "text/plain" }],
    ["kms key", { encryptionKeyReference: "arn:aws:kms:us-east-2:123456789012:key/other" }],
    ["version", { versionId: undefined }],
    ["provider", { provider: "local" }],
  ])("rejects a %s mismatch without any database side effect", async (_label, overrides) => {
    validEnvironment()
    const { GeneratedPdfStorageError, storeGeneratedPdfDurably } = await import("@/lib/pdf/store-generated-pdf")
    await expect(
      storeGeneratedPdfDurably(adapterReturning(overrides), "organizations/o/d.pdf", Buffer.from("bytes")),
    ).rejects.toBeInstanceOf(GeneratedPdfStorageError)
  })

  it("refuses to run at all without the S3 configuration", async () => {
    vi.stubEnv("STORAGE_PROVIDER", "local")
    const { GeneratedPdfStorageError, storeGeneratedPdfDurably } = await import("@/lib/pdf/store-generated-pdf")
    await expect(storeGeneratedPdfDurably(adapterReturning(), "k", Buffer.from("b"))).rejects.toBeInstanceOf(GeneratedPdfStorageError)
  })
})

