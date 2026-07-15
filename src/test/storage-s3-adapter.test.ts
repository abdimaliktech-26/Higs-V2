import fs from "fs/promises"
import path from "path"
import { PutObjectCommand, HeadObjectCommand, type S3Client } from "@aws-sdk/client-s3"
import { describe, expect, it, vi } from "vitest"
import { S3StorageAdapter, mapS3Error } from "@/lib/storage/s3-adapter"
import { StorageNotFoundError, StorageProviderAuthorizationError, StorageTransientProviderError } from "@/lib/storage/errors"
import { sha256Hex } from "@/lib/storage/utils"

function adapter(send: ReturnType<typeof vi.fn>) {
  return new S3StorageAdapter({
    region: "us-east-2",
    durableBucket: "durable-bucket",
    quarantineBucket: "quarantine-bucket",
    kmsKeyArn: "arn:aws:kms:us-east-2:123456789012:key/test",
    client: { send } as unknown as S3Client,
  })
}

describe("S3 storage adapter", () => {
  it("constructs a durable SSE-KMS put and returns provider metadata", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(PutObjectCommand)
      const input = (command as PutObjectCommand).input
      expect(input).toMatchObject({
        Bucket: "durable-bucket",
        Key: "organizations/opaque/file.pdf",
        ContentType: "application/pdf",
        ContentLength: 3,
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: "arn:aws:kms:us-east-2:123456789012:key/test",
      })
      expect(input.ACL).toBeUndefined()
      expect(input.ChecksumSHA256).toBeTruthy()
      expect(input.Metadata?.sha256).toBe(sha256Hex(Buffer.from("pdf")))
      return { VersionId: "version-1", ETag: "etag-1", $metadata: { requestId: "request-1" } }
    })
    const stored = await adapter(send).putObject({
      key: "organizations/opaque/file.pdf",
      body: Buffer.from("pdf"),
      expectedContentLength: 3,
      mimeType: "application/pdf",
      checksumSha256: sha256Hex(Buffer.from("pdf")),
    })
    expect(stored).toMatchObject({ provider: "s3", bucket: "durable-bucket", versionId: "version-1", etag: "etag-1", providerRequestId: "request-1" })
  })

  it("routes quarantine operations to the separate bucket", async () => {
    const send = vi.fn(async (command: unknown) => {
      expect((command as PutObjectCommand).input.Bucket).toBe("quarantine-bucket")
      return { VersionId: "quarantine-version", $metadata: {} }
    })
    await adapter(send).putObject({ key: "organizations/opaque/upload", location: "quarantine", body: Buffer.from("x"), mimeType: "application/octet-stream", checksumSha256: sha256Hex(Buffer.from("x")) })
  })

  it("reads version, ETag, checksum, encryption and safe request metadata from HEAD", async () => {
    const checksum = sha256Hex(Buffer.from("pdf"))
    const send = vi.fn(async (command: unknown) => {
      expect(command).toBeInstanceOf(HeadObjectCommand)
      expect((command as HeadObjectCommand).input).toMatchObject({ Bucket: "durable-bucket", VersionId: "version-1", ChecksumMode: "ENABLED" })
      return {
        VersionId: "version-1", ETag: "etag", ContentLength: 3, ContentType: "application/pdf",
        Metadata: { sha256: checksum }, SSEKMSKeyId: "kms-ref", LastModified: new Date(10), $metadata: { requestId: "safe-request-id" },
      }
    })
    await expect(adapter(send).getObjectMetadata({ key: "organizations/opaque/file.pdf", versionId: "version-1" })).resolves.toMatchObject({
      versionId: "version-1", etag: "etag", checksumSha256: checksum, encryptionKeyReference: "kms-ref", providerRequestId: "safe-request-id",
    })
  })

  it("maps provider errors without exposing provider responses", () => {
    const notFound = mapS3Error({ name: "NoSuchKey", message: "bucket/key", $metadata: { httpStatusCode: 404, requestId: "req-404" } })
    expect(notFound).toBeInstanceOf(StorageNotFoundError)
    expect(notFound.message).not.toContain("bucket/key")
    expect((notFound as StorageNotFoundError).diagnostics).toEqual({ providerRequestId: "req-404" })

    const denied = mapS3Error({ name: "AccessDenied", credentials: "secret", $metadata: { httpStatusCode: 403 } })
    expect(denied).toBeInstanceOf(StorageProviderAuthorizationError)
    expect(JSON.stringify(denied)).not.toContain("secret")

    expect(mapS3Error({ name: "Unknown", raw: "unsafe" })).toBeInstanceOf(StorageTransientProviderError)
  })

  it("rejects signed reads over 60 seconds and requires an object version", async () => {
    const storage = adapter(vi.fn())
    await expect(storage.createSignedReadUrl({ key: "file", versionId: "v1" }, { expiresInSeconds: 61 })).rejects.toThrow("between 1 and 60")
    await expect(storage.createSignedReadUrl({ key: "file" }, { expiresInSeconds: 60 })).rejects.toThrow("bound to an object version")
  })

  it("preserves typed unsafe-key errors without sending a provider request", async () => {
    const send = vi.fn()
    await expect(adapter(send).objectExists({ key: "../escape.pdf" })).rejects.toMatchObject({ code: "PATH_TRAVERSAL" })
    expect(send).not.toHaveBeenCalled()
  })

  it("has no application call site for native S3 signed URLs", async () => {
    const root = path.join(process.cwd(), "src")
    const files: string[] = []
    async function walk(directory: string): Promise<void> {
      for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name)
        if (entry.isDirectory()) await walk(full)
        else if (/\.(ts|tsx)$/.test(entry.name) && !full.includes(`${path.sep}test${path.sep}`)) files.push(full)
      }
    }
    await walk(root)
    const callSites = []
    for (const file of files) {
      if (file.includes(`${path.sep}lib${path.sep}storage${path.sep}`)) continue
      const text = await fs.readFile(file, "utf8")
      if (text.includes("createSignedReadUrl(") || text.includes("createSignedUploadUrl(")) callSites.push(file)
    }
    expect(callSites).toEqual([])
  })
})
