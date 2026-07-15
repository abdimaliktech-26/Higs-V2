import fs from "fs/promises"
import os from "os"
import path from "path"
import { Readable } from "stream"
import { afterEach, describe, expect, it } from "vitest"
import { LocalStorageAdapter } from "@/lib/storage/local-adapter"
import { MemoryStorageAdapter } from "@/lib/storage/memory-adapter"
import { StorageConflictError, StorageNotFoundError, StorageUnsupportedOperationError } from "@/lib/storage/errors"
import type { StorageAdapter } from "@/lib/storage/types"
import { sha256Hex } from "@/lib/storage/utils"

const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function read(adapter: StorageAdapter, key: string, versionId?: string): Promise<string> {
  const result = await adapter.getObjectStream({ key, versionId })
  const chunks: Buffer[] = []
  for await (const chunk of result.stream) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString("utf8")
}

function contract(name: string, create: () => Promise<StorageAdapter>) {
  describe(`${name} storage contract`, () => {
    it("round-trips streams with checksum and metadata", async () => {
      const adapter = await create()
      const body = Buffer.from("contract-stream")
      const stored = await adapter.putObject({
        key: "organizations/test/object.bin",
        body: Readable.from(body),
        expectedContentLength: body.length,
        mimeType: "application/octet-stream",
        checksumSha256: sha256Hex(body),
        metadata: { purpose: "contract" },
      })
      expect(await read(adapter, stored.key, stored.versionId)).toBe("contract-stream")
      expect(stored).toMatchObject({ size: body.length, checksumSha256: sha256Hex(body), mimeType: "application/octet-stream" })
      expect((await adapter.getObjectMetadata({ key: stored.key, versionId: stored.versionId })).metadata).toEqual({ purpose: "contract" })
    })

    it("supports existence, copy, and delete consistently", async () => {
      const adapter = await create()
      await adapter.putObject({ key: "source/file.pdf", body: Buffer.from("pdf"), mimeType: "application/pdf" })
      const copied = await adapter.copyObject({ source: { key: "source/file.pdf" }, destination: { key: "destination/file.pdf" } })
      expect(copied.key).toBe("destination/file.pdf")
      expect(await read(adapter, copied.key, copied.versionId)).toBe("pdf")
      expect(await adapter.objectExists({ key: copied.key })).toBe(true)
      await adapter.deleteObject({ key: copied.key })
      expect(await adapter.objectExists({ key: copied.key })).toBe(false)
    })

    it("returns a typed error for a missing object", async () => {
      const adapter = await create()
      await expect(adapter.getObjectMetadata({ key: "missing/file.pdf" })).rejects.toBeInstanceOf(StorageNotFoundError)
    })

    it("rejects unsafe keys instead of treating them as missing", async () => {
      const adapter = await create()
      await expect(adapter.objectExists({ key: "../escape.pdf" })).rejects.toMatchObject({ code: "PATH_TRAVERSAL" })
    })

    it("does not expose native signed URLs", async () => {
      const adapter = await create()
      await expect(adapter.createSignedReadUrl({ key: "file.pdf" }, { expiresInSeconds: 60 })).rejects.toBeInstanceOf(StorageUnsupportedOperationError)
    })
  })
}

contract("local", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "higsi-storage-"))
  temporaryRoots.push(root)
  return new LocalStorageAdapter({ root })
})

contract("memory", async () => new MemoryStorageAdapter())

describe("local adapter safety", () => {
  it("uses the configured root and cannot escape it", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "higsi-root-"))
    temporaryRoots.push(root)
    const adapter = new LocalStorageAdapter({ root })
    await adapter.putObject({ key: "safe/file.pdf", body: Buffer.from("safe"), mimeType: "application/pdf" })
    expect(await fs.readFile(path.join(root, "durable", "safe", "file.pdf"), "utf8")).toBe("safe")
    await expect(adapter.putObject({ key: "../escape.pdf", body: Buffer.from("bad"), mimeType: "application/pdf" })).rejects.toThrow()
  })
})

describe("memory adapter versions", () => {
  it("creates deterministic versions and preserves older versions after live deletion", async () => {
    const adapter = new MemoryStorageAdapter()
    const first = await adapter.putObject({ key: "versioned/file", body: Buffer.from("one"), mimeType: "text/plain" })
    const second = await adapter.putObject({ key: "versioned/file", body: Buffer.from("two"), mimeType: "text/plain" })
    expect(first.versionId).toBe("memory-00000001")
    expect(second.versionId).toBe("memory-00000002")
    await adapter.deleteObject({ key: "versioned/file" })
    expect(await adapter.objectExists({ key: "versioned/file" })).toBe(false)
    expect(await read(adapter, "versioned/file", first.versionId)).toBe("one")
  })

  it("simulates create-only and immutable preconditions", async () => {
    const adapter = new MemoryStorageAdapter()
    await adapter.putObject({ key: "immutable/file", body: Buffer.from("one"), mimeType: "text/plain", preconditions: { immutable: true } })
    await expect(adapter.putObject({ key: "immutable/file", body: Buffer.from("two"), mimeType: "text/plain", preconditions: { ifNoneMatch: true } })).rejects.toBeInstanceOf(StorageConflictError)
    await expect(adapter.deleteObject({ key: "immutable/file" })).rejects.toBeInstanceOf(StorageConflictError)
  })
})
