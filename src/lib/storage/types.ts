import type { Readable } from "stream"

export type StorageProvider = "local" | "memory" | "s3"
export type StorageLocation = "durable" | "quarantine"
export type StorageBody = Buffer | Uint8Array | Readable

export interface StorageLocator {
  key: string
  location?: StorageLocation
  versionId?: string
}

export interface StorageEncryptionRequirement {
  mode: "none" | "sse-kms"
  keyReference?: string
}

export interface StorageWritePreconditions {
  ifNoneMatch?: boolean
  immutable?: boolean
}

export interface PutObjectInput {
  key: string
  body: StorageBody
  location?: StorageLocation
  expectedContentLength?: number
  mimeType: string
  checksumSha256?: string
  metadata?: Record<string, string>
  encryption?: StorageEncryptionRequirement
  preconditions?: StorageWritePreconditions
}

export interface StorageObjectMetadata {
  provider: StorageProvider
  bucket: string
  key: string
  location: StorageLocation
  versionId?: string
  etag?: string
  checksumSha256: string
  size: number
  mimeType: string
  encryptionKeyReference?: string
  lastModified: Date
  metadata: Record<string, string>
  providerRequestId?: string
}

export interface StorageObjectStream {
  stream: Readable
  metadata: StorageObjectMetadata
}

export interface DeleteObjectOptions {
  requireExists?: boolean
}

export interface CopyObjectInput {
  source: StorageLocator
  destination: StorageLocator
  mimeType?: string
  checksumSha256?: string
  metadata?: Record<string, string>
  encryption?: StorageEncryptionRequirement
  preconditions?: StorageWritePreconditions
}

export interface SignedUrlOptions {
  expiresInSeconds: number
}

export interface SignedUploadInput {
  key: string
  location?: StorageLocation
  mimeType: string
  expectedContentLength?: number
  checksumSha256?: string
  metadata?: Record<string, string>
  encryption?: StorageEncryptionRequirement
  preconditions?: StorageWritePreconditions
}

export interface StorageAdapter {
  readonly provider: StorageProvider
  putObject(input: PutObjectInput): Promise<StorageObjectMetadata>
  getObjectStream(locator: StorageLocator): Promise<StorageObjectStream>
  deleteObject(locator: StorageLocator, options?: DeleteObjectOptions): Promise<void>
  objectExists(locator: StorageLocator): Promise<boolean>
  copyObject(input: CopyObjectInput): Promise<StorageObjectMetadata>
  getObjectMetadata(locator: StorageLocator): Promise<StorageObjectMetadata>
  createSignedReadUrl(locator: StorageLocator, options: SignedUrlOptions): Promise<string>
  createSignedUploadUrl(input: SignedUploadInput, options: SignedUrlOptions): Promise<string>
}
