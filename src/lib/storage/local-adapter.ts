import fs from "fs/promises"
import path from "path"
import { createReadStream, createWriteStream } from "fs"
import {
  StorageConflictError,
  StorageNotFoundError,
  StoragePathTraversalError,
  StorageUnsupportedOperationError,
} from "./errors"
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
import { pipeAndHash, sha256Hex, verifyExpectedIntegrity } from "./utils"

interface LocalSidecar {
  checksumSha256: string
  size: number
  mimeType: string
  metadata: Record<string, string>
  immutable: boolean
  lastModified: string
}

export interface LocalStorageAdapterOptions {
  root: string
  separateLocations?: boolean
}

export class LocalStorageAdapter implements StorageAdapter {
  readonly provider = "local" as const
  private readonly root: string
  private readonly separateLocations: boolean

  constructor(options: LocalStorageAdapterOptions) {
    this.root = path.resolve(options.root)
    this.separateLocations = options.separateLocations ?? true
  }

  private location(locator: { location?: StorageLocation }): StorageLocation {
    return locator.location ?? "durable"
  }

  private resolve(locator: { key: string; location?: StorageLocation }): string {
    const key = validateStorageKey(locator.key)
    const base = this.separateLocations ? path.join(this.root, this.location(locator)) : this.root
    const resolved = path.resolve(base, key)
    const relative = path.relative(base, resolved)
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new StoragePathTraversalError()
    return resolved
  }

  private sidecarPath(filePath: string): string {
    return `${filePath}.storage-metadata.json`
  }

  private bucket(location: StorageLocation): string {
    return `local-${location}`
  }

  private async readSidecar(filePath: string): Promise<LocalSidecar | null> {
    try {
      return JSON.parse(await fs.readFile(this.sidecarPath(filePath), "utf8")) as LocalSidecar
    } catch {
      return null
    }
  }

  async putObject(input: PutObjectInput): Promise<StorageObjectMetadata> {
    if (input.encryption?.mode === "sse-kms") throw new StorageUnsupportedOperationError("Local storage cannot provide SSE-KMS")
    const location = this.location(input)
    const filePath = this.resolve(input)
    if (input.preconditions?.ifNoneMatch && await this.objectExists(input)) throw new StorageConflictError()
    await fs.mkdir(path.dirname(filePath), { recursive: true })
    const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`
    try {
      const integrity = await pipeAndHash(input.body, createWriteStream(temporaryPath, { flags: "wx" }))
      verifyExpectedIntegrity({
        actualChecksum: integrity.checksumSha256,
        actualSize: integrity.size,
        expectedChecksum: input.checksumSha256,
        expectedSize: input.expectedContentLength,
      })
      await fs.rename(temporaryPath, filePath)
      const lastModified = new Date()
      const sidecar: LocalSidecar = {
        ...integrity,
        mimeType: input.mimeType,
        metadata: { ...(input.metadata ?? {}) },
        immutable: input.preconditions?.immutable ?? false,
        lastModified: lastModified.toISOString(),
      }
      await fs.writeFile(this.sidecarPath(filePath), JSON.stringify(sidecar), "utf8")
      return {
        provider: this.provider,
        bucket: this.bucket(location),
        key: input.key,
        location,
        checksumSha256: integrity.checksumSha256,
        size: integrity.size,
        mimeType: input.mimeType,
        encryptionKeyReference: input.encryption?.keyReference,
        lastModified,
        metadata: sidecar.metadata,
      }
    } catch (error) {
      await fs.rm(temporaryPath, { force: true }).catch(() => undefined)
      throw error
    }
  }

  async getObjectStream(locator: StorageLocator): Promise<StorageObjectStream> {
    const metadata = await this.getObjectMetadata(locator)
    return { stream: createReadStream(this.resolve(locator)), metadata }
  }

  async deleteObject(locator: StorageLocator, options: DeleteObjectOptions = {}): Promise<void> {
    const filePath = this.resolve(locator)
    const sidecar = await this.readSidecar(filePath)
    if (sidecar?.immutable) throw new StorageConflictError("The stored object is immutable")
    try {
      await fs.unlink(filePath)
      await fs.rm(this.sidecarPath(filePath), { force: true })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT" && !options.requireExists) return
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageNotFoundError()
      throw error
    }
  }

  async objectExists(locator: StorageLocator): Promise<boolean> {
    const filePath = this.resolve(locator)
    try {
      return (await fs.stat(filePath)).isFile()
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error
      return false
    }
  }

  async copyObject(input: CopyObjectInput): Promise<StorageObjectMetadata> {
    if (input.encryption?.mode === "sse-kms") throw new StorageUnsupportedOperationError("Local storage cannot provide SSE-KMS")
    const source = await this.getObjectStream(input.source)
    return this.putObject({
      key: input.destination.key,
      location: input.destination.location,
      body: source.stream,
      expectedContentLength: source.metadata.size,
      mimeType: input.mimeType ?? source.metadata.mimeType,
      checksumSha256: input.checksumSha256 ?? source.metadata.checksumSha256,
      metadata: input.metadata ?? source.metadata.metadata,
      encryption: input.encryption,
      preconditions: input.preconditions,
    })
  }

  async getObjectMetadata(locator: StorageLocator): Promise<StorageObjectMetadata> {
    if (locator.versionId) throw new StorageUnsupportedOperationError("Local storage does not support object versions")
    const location = this.location(locator)
    const filePath = this.resolve(locator)
    try {
      const stat = await fs.stat(filePath)
      if (!stat.isFile()) throw new StorageNotFoundError()
      const sidecar = await this.readSidecar(filePath)
      const data = sidecar ? null : await fs.readFile(filePath)
      return {
        provider: this.provider,
        bucket: this.bucket(location),
        key: locator.key,
        location,
        checksumSha256: sidecar?.checksumSha256 ?? sha256Hex(data as Buffer),
        size: sidecar?.size ?? stat.size,
        mimeType: sidecar?.mimeType ?? "application/octet-stream",
        lastModified: sidecar ? new Date(sidecar.lastModified) : stat.mtime,
        metadata: sidecar?.metadata ?? {},
      }
    } catch (error) {
      if (error instanceof StorageNotFoundError) throw error
      if ((error as NodeJS.ErrnoException).code === "ENOENT") throw new StorageNotFoundError()
      throw error
    }
  }

  async createSignedReadUrl(_locator: StorageLocator, _options: SignedUrlOptions): Promise<string> {
    throw new StorageUnsupportedOperationError("Local storage does not create native signed URLs")
  }

  async createSignedUploadUrl(_input: SignedUploadInput, _options: SignedUrlOptions): Promise<string> {
    throw new StorageUnsupportedOperationError("Local storage does not create native signed upload URLs")
  }
}
