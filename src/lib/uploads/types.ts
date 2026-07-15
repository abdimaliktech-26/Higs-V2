import type {
  StorageProvider as DatabaseStorageProvider,
  StoredObjectMalwareStatus,
  UploadActorType,
  UploadCleanupStatus,
  UploadFailureCategory,
  UploadFailureStage,
  UploadKind,
  UploadOwnerType,
  UploadStatus,
} from "@prisma/client"
import type { Readable } from "node:stream"

export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024
export const ORDINARY_QUARANTINE_RETENTION_MS = 24 * 60 * 60 * 1000
export const SUSPECT_QUARANTINE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000

export type UploadFileFormat = "pdf" | "jpeg" | "png" | "docx"

export interface UploadValidationPolicy {
  readonly kind: UploadKind
  readonly maxBytes: number
  readonly formats: Readonly<Partial<Record<UploadFileFormat, UploadFormatPolicy>>>
  readonly image: {
    maxWidth: number
    maxHeight: number
    maxPixels: number
    maxFrames: number
    maxDecompressedBytes: number
  }
  readonly pdf: {
    maxPages: number
    rejectEncrypted: true
    rejectActiveContent: true
    rejectEmbeddedFiles: true
    rejectXfa: true
  }
  readonly docx: {
    maxEntries: number
    maxCompressedBytes: number
    maxDecompressedBytes: number
    maxCompressionRatio: number
    rejectMacros: true
    rejectExecutables: true
    rejectExternalRelationships: true
  }
}

export interface UploadFormatPolicy {
  readonly extensions: readonly string[]
  readonly mimeTypes: readonly string[]
}

export interface UploadValidationSource {
  readonly path: string
  readonly size: number
  openStream(): Readable
}

export interface UploadValidationInput {
  source: UploadValidationSource
  extension: string
  declaredMimeType: string
  policy: UploadValidationPolicy
}

export interface UploadStructuralMetadata {
  pageCount?: number
  width?: number
  height?: number
  frameCount?: number
  archiveEntryCount?: number
}

export interface UploadValidationResult {
  format: UploadFileFormat
  detectedMimeType: string
  validatedExtension: string
  actualSize: number
  structural: UploadStructuralMetadata
}

export interface InitiatedUploadInput {
  organizationId: string
  uploadKind: UploadKind
  intendedOwnerType: UploadOwnerType
  intendedOwnerId: string
  parentResourceId?: string
  actor:
    | { type: "STAFF"; staffUserId: string }
    | { type: "PORTAL"; portalUserId: string }
  idempotencyKey: string
  artifactId: string
  plannedDurableObjectKey: string
  declaredMimeType?: string
  expectedSizeBytes?: number
  now?: Date
}

export interface QuarantineMetadata {
  provider: DatabaseStorageProvider
  bucket: string
  objectKey: string
  objectVersionId?: string
  etag?: string
  actualSizeBytes: number
  checksumSha256: string
  quarantinedAt: Date
}

export interface VerifiedPromotionMetadata {
  provider: DatabaseStorageProvider
  bucket: string
  objectKey: string
  objectVersionId?: string
  etag?: string
  checksumSha256: string
  sizeBytes: number
  mimeType: string
  encryptionKeyRef?: string
  providerVerified: boolean
  encryptionVerified: boolean
  promotedAt: Date
}

export interface UploadAttemptState {
  id: string
  status: UploadStatus
  malwareStatus: StoredObjectMalwareStatus
  cleanupStatus: UploadCleanupStatus
  failureStage: UploadFailureStage | null
  failureCategory: UploadFailureCategory | null
}

export interface SafeUploadSummary {
  attemptId: string
  organizationId: string
  uploadKind: UploadKind
  actorType: UploadActorType
  ownerType: UploadOwnerType
  ownerId: string
  status: UploadStatus
  malwareStatus: StoredObjectMalwareStatus
  cleanupStatus: UploadCleanupStatus
  failureStage?: UploadFailureStage
  failureCategory?: UploadFailureCategory
  createdAt: Date
  updatedAt: Date
}
