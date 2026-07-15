import { Readable } from "stream"
import { StorageConflictError, StorageError, StorageNotFoundError, StorageUnsupportedOperationError } from "./errors"
import { validateStorageKey } from "./keys"
import type {
  CopyObjectInput,
  DeleteObjectOptions,
  PutObjectInput,
  SignedUploadInput,
  SignedUrlOptions,
  StorageAdapter,
  StorageLocation,
  StorageLocator,
  StorageObjectMetadata,
  StorageObjectStream,
} from "./types"
import { collectBody, sha256Hex, verifyExpectedIntegrity } from "./utils"

interface MemoryVersion {
  data: Buffer
  metadata: StorageObjectMetadata
  immutable: boolean
}

interface MemoryEntry {
  versions: MemoryVersion[]
  liveVersionId?: string
}

export class MemoryStorageAdapter implements StorageAdapter {
  readonly provider = "memory" as const
  private readonly entries = new Map<string, MemoryEntry>()
  private version = 0
  private clock = 0

  private location(locator: { location?: StorageLocation }): StorageLocation {
    return locator.location ?? "durable"
  }

  private mapKey(locator: { key: string; location?: StorageLocation }): string {
    return `${this.location(locator)}:${validateStorageKey(locator.key)}`
  }

  private find(locator: StorageLocator): MemoryVersion {
    const entry = this.entries.get(this.mapKey(locator))
    const versionId = locator.versionId ?? entry?.liveVersionId
    const value = entry?.versions.find((candidate) => candidate.metadata.versionId === versionId)
    if (!value) throw new StorageNotFoundError()
    return value
  }

  async putObject(input: PutObjectInput): Promise<StorageObjectMetadata> {
    const mapKey = this.mapKey(input)
    const current = this.entries.get(mapKey)
    if (input.preconditions?.ifNoneMatch && current?.liveVersionId) throw new StorageConflictError()
    const data = await collectBody(input.body)
    const checksumSha256 = sha256Hex(data)
    verifyExpectedIntegrity({
      actualChecksum: checksumSha256,
      actualSize: data.length,
      expectedChecksum: input.checksumSha256,
      expectedSize: input.expectedContentLength,
    })
    const location = this.location(input)
    const versionId = `memory-${String(++this.version).padStart(8, "0")}`
    const metadata: StorageObjectMetadata = {
      provider: this.provider,
      bucket: `memory-${location}`,
      key: input.key,
      location,
      versionId,
      etag: checksumSha256,
      checksumSha256,
      size: data.length,
      mimeType: input.mimeType,
      encryptionKeyReference: input.encryption?.keyReference,
      lastModified: new Date(++this.clock),
      metadata: { ...(input.metadata ?? {}) },
    }
    const version: MemoryVersion = { data, metadata, immutable: input.preconditions?.immutable ?? false }
    const entry = current ?? { versions: [] }
    entry.versions.push(version)
    entry.liveVersionId = versionId
    this.entries.set(mapKey, entry)
    return { ...metadata, metadata: { ...metadata.metadata } }
  }

  async getObjectStream(locator: StorageLocator): Promise<StorageObjectStream> {
    const value = this.find(locator)
    return { stream: Readable.from(Buffer.from(value.data)), metadata: { ...value.metadata, metadata: { ...value.metadata.metadata } } }
  }

  async deleteObject(locator: StorageLocator, options: DeleteObjectOptions = {}): Promise<void> {
    const mapKey = this.mapKey(locator)
    const entry = this.entries.get(mapKey)
    if (!entry) {
      if (options.requireExists) throw new StorageNotFoundError()
      return
    }
    const target = this.find(locator)
    if (target.immutable) throw new StorageConflictError("The stored object is immutable")
    if (locator.versionId) {
      entry.versions = entry.versions.filter((candidate) => candidate.metadata.versionId !== locator.versionId)
      if (entry.liveVersionId === locator.versionId) entry.liveVersionId = undefined
    } else {
      entry.liveVersionId = undefined
    }
  }

  async objectExists(locator: StorageLocator): Promise<boolean> {
    try {
      this.find(locator)
      return true
    } catch (error) {
      if (error instanceof StorageError && !(error instanceof StorageNotFoundError)) throw error
      return false
    }
  }

  async copyObject(input: CopyObjectInput): Promise<StorageObjectMetadata> {
    const source = this.find(input.source)
    return this.putObject({
      key: input.destination.key,
      location: input.destination.location,
      body: Buffer.from(source.data),
      expectedContentLength: source.data.length,
      mimeType: input.mimeType ?? source.metadata.mimeType,
      checksumSha256: input.checksumSha256 ?? source.metadata.checksumSha256,
      metadata: input.metadata ?? source.metadata.metadata,
      encryption: input.encryption,
      preconditions: input.preconditions,
    })
  }

  async getObjectMetadata(locator: StorageLocator): Promise<StorageObjectMetadata> {
    const metadata = this.find(locator).metadata
    return { ...metadata, metadata: { ...metadata.metadata } }
  }

  async createSignedReadUrl(_locator: StorageLocator, _options: SignedUrlOptions): Promise<string> {
    throw new StorageUnsupportedOperationError("Memory storage does not create signed URLs")
  }

  async createSignedUploadUrl(_input: SignedUploadInput, _options: SignedUrlOptions): Promise<string> {
    throw new StorageUnsupportedOperationError("Memory storage does not create signed upload URLs")
  }
}
