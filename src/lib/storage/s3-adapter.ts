import "server-only"

import { Readable } from "stream"
import {
  CopyObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"
import {
  StorageConflictError,
  StorageError,
  StorageIntegrityError,
  StorageNotFoundError,
  StorageProviderAuthorizationError,
  StorageThrottledError,
  StorageTransientProviderError,
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
import { bodyAsReadable, normalizeSha256, sha256Hex, validateSignedUrlTtl } from "./utils"

export interface S3StorageAdapterOptions {
  region: string
  durableBucket: string
  quarantineBucket: string
  kmsKeyArn: string
  endpoint?: string
  client?: S3Client
  maxAttempts?: number
}

function requestId(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined
  const metadata = (error as { $metadata?: { requestId?: string } }).$metadata
  return metadata?.requestId
}

export function mapS3Error(error: unknown): Error {
  const value = error as { name?: string; $metadata?: { httpStatusCode?: number; requestId?: string } }
  const diagnostics = { providerRequestId: requestId(error) }
  const status = value?.$metadata?.httpStatusCode
  if (value?.name === "NoSuchKey" || value?.name === "NotFound" || status === 404) return new StorageNotFoundError(diagnostics)
  if (value?.name === "PreconditionFailed" || status === 409 || status === 412) return new StorageConflictError(undefined, diagnostics)
  if (value?.name === "AccessDenied" || value?.name === "InvalidAccessKeyId" || value?.name === "SignatureDoesNotMatch" || status === 401 || status === 403) {
    return new StorageProviderAuthorizationError(diagnostics)
  }
  if (value?.name === "SlowDown" || value?.name === "Throttling" || status === 429) return new StorageThrottledError(diagnostics)
  return new StorageTransientProviderError(diagnostics)
}

function checksumBase64ToHex(value: string | undefined): string | undefined {
  if (!value) return undefined
  try { return Buffer.from(value, "base64").toString("hex") } catch { return undefined }
}

function checksumHexToBase64(value: string): string {
  return Buffer.from(normalizeSha256(value), "hex").toString("base64")
}

export class S3StorageAdapter implements StorageAdapter {
  readonly provider = "s3" as const
  readonly client: S3Client
  private readonly durableBucket: string
  private readonly quarantineBucket: string
  private readonly kmsKeyArn: string

  constructor(options: S3StorageAdapterOptions) {
    this.durableBucket = options.durableBucket
    this.quarantineBucket = options.quarantineBucket
    this.kmsKeyArn = options.kmsKeyArn
    const config: S3ClientConfig = {
      region: options.region,
      maxAttempts: options.maxAttempts ?? 3,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
    }
    // No credentials are supplied: the SDK's default chain supports workload
    // identity, web identity, instance roles, and local developer profiles.
    this.client = options.client ?? new S3Client(config)
  }

  private location(value: { location?: StorageLocation }): StorageLocation {
    return value.location ?? "durable"
  }

  private bucket(value: { location?: StorageLocation }): string {
    return this.location(value) === "quarantine" ? this.quarantineBucket : this.durableBucket
  }

  private safeKey(value: { key: string }): string {
    return validateStorageKey(value.key)
  }

  private validateEncryption(requirement: PutObjectInput["encryption"] | CopyObjectInput["encryption"] | SignedUploadInput["encryption"]): void {
    if (!requirement) return
    if (requirement.mode !== "sse-kms" || (requirement.keyReference && requirement.keyReference !== this.kmsKeyArn)) {
      throw new StorageConflictError("The requested encryption does not match the configured storage policy")
    }
  }

  async putObject(input: PutObjectInput): Promise<StorageObjectMetadata> {
    if (input.preconditions?.immutable) {
      throw new StorageUnsupportedOperationError("Object retention is not active in PR-5A")
    }
    this.validateEncryption(input.encryption)
    const isBuffered = Buffer.isBuffer(input.body) || input.body instanceof Uint8Array
    const bufferedBody = isBuffered ? Buffer.from(input.body as Buffer | Uint8Array) : undefined
    const checksum = input.checksumSha256
      ? normalizeSha256(input.checksumSha256)
      : bufferedBody
        ? sha256Hex(bufferedBody)
        : undefined
    const contentLength = input.expectedContentLength ?? bufferedBody?.length
    if (!checksum) throw new StorageIntegrityError("S3 streaming writes require a verified SHA-256 checksum")
    if (contentLength === undefined) throw new StorageIntegrityError("S3 streaming writes require an expected content length")
    try {
      const output = await this.client.send(new PutObjectCommand({
        Bucket: this.bucket(input),
        Key: this.safeKey(input),
        Body: bodyAsReadable(input.body),
        ContentLength: contentLength,
        ContentType: input.mimeType,
        ChecksumSHA256: checksumHexToBase64(checksum),
        Metadata: { ...(input.metadata ?? {}), sha256: checksum },
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.kmsKeyArn,
        IfNoneMatch: input.preconditions?.ifNoneMatch ? "*" : undefined,
      }))
      return {
        provider: this.provider,
        bucket: this.bucket(input),
        key: input.key,
        location: this.location(input),
        versionId: output.VersionId,
        etag: output.ETag,
        checksumSha256: checksum,
        size: contentLength,
        mimeType: input.mimeType,
        encryptionKeyReference: this.kmsKeyArn,
        lastModified: new Date(),
        metadata: { ...(input.metadata ?? {}) },
        providerRequestId: output.$metadata.requestId,
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }

  async getObjectStream(locator: StorageLocator): Promise<StorageObjectStream> {
    try {
      const output = await this.client.send(new GetObjectCommand({
        Bucket: this.bucket(locator),
        Key: this.safeKey(locator),
        VersionId: locator.versionId,
        ChecksumMode: "ENABLED",
      }))
      if (!output.Body) throw new StorageNotFoundError({ providerRequestId: output.$metadata.requestId })
      let stream: Readable
      if (output.Body instanceof Readable) {
        stream = output.Body
      } else {
        stream = Readable.fromWeb(output.Body.transformToWebStream() as never)
      }
      const checksumSha256 = output.Metadata?.sha256 ?? checksumBase64ToHex(output.ChecksumSHA256) ?? ""
      return {
        stream,
        metadata: {
          provider: this.provider,
          bucket: this.bucket(locator),
          key: locator.key,
          location: this.location(locator),
          versionId: output.VersionId ?? locator.versionId,
          etag: output.ETag,
          checksumSha256,
          size: output.ContentLength ?? 0,
          mimeType: output.ContentType ?? "application/octet-stream",
          encryptionKeyReference: output.SSEKMSKeyId,
          lastModified: output.LastModified ?? new Date(0),
          metadata: { ...(output.Metadata ?? {}) },
          providerRequestId: output.$metadata.requestId,
        },
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }

  async deleteObject(locator: StorageLocator, options: DeleteObjectOptions = {}): Promise<void> {
    if (options.requireExists) await this.getObjectMetadata(locator)
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket(locator),
        Key: this.safeKey(locator),
        VersionId: locator.versionId,
      }))
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }

  async objectExists(locator: StorageLocator): Promise<boolean> {
    try {
      await this.getObjectMetadata(locator)
      return true
    } catch (error) {
      if (error instanceof StorageNotFoundError) return false
      throw error
    }
  }

  async copyObject(input: CopyObjectInput): Promise<StorageObjectMetadata> {
    if (input.preconditions?.immutable) throw new StorageUnsupportedOperationError("Object retention is not active in PR-5A")
    this.validateEncryption(input.encryption)
    if (input.preconditions?.ifNoneMatch && await this.objectExists(input.destination)) throw new StorageConflictError()
    const sourceMetadata = await this.getObjectMetadata(input.source)
    const checksum = input.checksumSha256 ? normalizeSha256(input.checksumSha256) : sourceMetadata.checksumSha256
    if (input.checksumSha256 && checksum !== sourceMetadata.checksumSha256) {
      throw new StorageIntegrityError("The copied object checksum did not match the expected checksum")
    }
    const sourceBucket = this.bucket(input.source)
    const encodedKey = this.safeKey(input.source).split("/").map(encodeURIComponent).join("/")
    const version = input.source.versionId ? `?versionId=${encodeURIComponent(input.source.versionId)}` : ""
    try {
      const output = await this.client.send(new CopyObjectCommand({
        Bucket: this.bucket(input.destination),
        Key: this.safeKey(input.destination),
        CopySource: `${encodeURIComponent(sourceBucket)}/${encodedKey}${version}`,
        ContentType: input.mimeType ?? sourceMetadata.mimeType,
        Metadata: { ...sourceMetadata.metadata, ...(input.metadata ?? {}), sha256: checksum },
        MetadataDirective: "REPLACE",
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.kmsKeyArn,
      }))
      return this.getObjectMetadata({ ...input.destination, versionId: output.VersionId })
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }

  async getObjectMetadata(locator: StorageLocator): Promise<StorageObjectMetadata> {
    try {
      const output = await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket(locator),
        Key: this.safeKey(locator),
        VersionId: locator.versionId,
        ChecksumMode: "ENABLED",
      }))
      return {
        provider: this.provider,
        bucket: this.bucket(locator),
        key: locator.key,
        location: this.location(locator),
        versionId: output.VersionId ?? locator.versionId,
        etag: output.ETag,
        checksumSha256: output.Metadata?.sha256 ?? checksumBase64ToHex(output.ChecksumSHA256) ?? "",
        size: output.ContentLength ?? 0,
        mimeType: output.ContentType ?? "application/octet-stream",
        encryptionKeyReference: output.SSEKMSKeyId,
        lastModified: output.LastModified ?? new Date(0),
        metadata: { ...(output.Metadata ?? {}) },
        providerRequestId: output.$metadata.requestId,
      }
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }

  async createSignedReadUrl(locator: StorageLocator, options: SignedUrlOptions): Promise<string> {
    if (!locator.versionId) throw new StorageConflictError("Signed read URLs must be bound to an object version")
    const expiresIn = validateSignedUrlTtl(options.expiresInSeconds)
    try {
      return await getSignedUrl(this.client, new GetObjectCommand({
        Bucket: this.bucket(locator), Key: this.safeKey(locator), VersionId: locator.versionId,
      }), { expiresIn })
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }

  async createSignedUploadUrl(input: SignedUploadInput, options: SignedUrlOptions): Promise<string> {
    if (input.preconditions?.immutable) throw new StorageUnsupportedOperationError("Object retention is not active in PR-5A")
    this.validateEncryption(input.encryption)
    const expiresIn = validateSignedUrlTtl(options.expiresInSeconds)
    if (!input.checksumSha256 || input.expectedContentLength === undefined) {
      throw new StorageIntegrityError("Signed S3 uploads require a verified checksum and expected content length")
    }
    const checksum = normalizeSha256(input.checksumSha256)
    try {
      return await getSignedUrl(this.client, new PutObjectCommand({
        Bucket: this.bucket(input),
        Key: this.safeKey(input),
        ContentLength: input.expectedContentLength,
        ContentType: input.mimeType,
        ChecksumSHA256: checksumHexToBase64(checksum),
        Metadata: { ...(input.metadata ?? {}), sha256: checksum },
        ServerSideEncryption: "aws:kms",
        SSEKMSKeyId: this.kmsKeyArn,
        IfNoneMatch: input.preconditions?.ifNoneMatch ? "*" : undefined,
      }), { expiresIn })
    } catch (error) {
      if (error instanceof StorageError) throw error
      throw mapS3Error(error)
    }
  }
}
