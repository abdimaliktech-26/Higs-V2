import "server-only"

import {
  StorageProvider,
  UploadFailureCategory,
  UploadFailureStage,
  UploadStatus,
  type UploadAttempt,
} from "@prisma/client"
import { readStorageConfiguration, type StorageAdapter } from "../storage/index"
import type { StorageObjectMetadata } from "../storage/types"
import { UploadLifecycleError } from "./errors"
import { beginPromotion, markUploadFailed, recordCompleted, recordVerifiedPromotion } from "./lifecycle"

export interface PromotedCleanUpload {
  attempt: UploadAttempt
  promoted: StorageObjectMetadata
}

/** Deletes the exact quarantine version after linkage and records COMPLETED. */
export async function finishQuarantineCleanup(attempt: UploadAttempt, adapter: StorageAdapter): Promise<void> {
  if (!attempt.quarantineObjectKey || !attempt.quarantineObjectVersionId) return
  await adapter.deleteObject({
    key: attempt.quarantineObjectKey,
    location: "quarantine",
    versionId: attempt.quarantineObjectVersionId,
  })
  await recordCompleted(attempt.id, UploadStatus.LINKED_CLEANUP_PENDING, new Date())
}

/**
 * Copies the exact scanned quarantine version to the planned durable key and
 * re-verifies provider, version, checksum, size, MIME type, and SSE-KMS key
 * evidence before recording the PENDING StoredObject. Shared by every
 * migrated writer kind; owner linkage stays kind-specific and later.
 */
export async function promoteVerifiedCleanUpload(
  attempt: UploadAttempt,
  expectedMimeType: string,
  adapter: StorageAdapter,
): Promise<PromotedCleanUpload> {
  if (!attempt.quarantineObjectKey || !attempt.quarantineObjectVersionId || !attempt.checksumSha256 || attempt.actualSizeBytes === null) {
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "The quarantine identity is incomplete.")
  }

  await beginPromotion(attempt.id)
  const configuration = readStorageConfiguration()
  let promoted: StorageObjectMetadata
  try {
    promoted = await adapter.copyObject({
      source: { key: attempt.quarantineObjectKey, location: "quarantine", versionId: attempt.quarantineObjectVersionId },
      destination: { key: attempt.plannedDurableObjectKey, location: "durable" },
      mimeType: expectedMimeType,
      checksumSha256: attempt.checksumSha256,
      encryption: { mode: "sse-kms" },
      preconditions: { ifNoneMatch: true },
      metadata: { uploadAttemptId: attempt.id },
    })
  } catch (error) {
    await markUploadFailed(attempt.id, UploadStatus.PROMOTING, UploadFailureStage.PROMOTION, UploadFailureCategory.PROMOTION_FAILURE, new Date()).catch(() => undefined)
    throw error
  }
  if (
    promoted.provider !== "s3" ||
    !promoted.versionId ||
    promoted.checksumSha256 !== attempt.checksumSha256 ||
    promoted.size !== Number(attempt.actualSizeBytes) ||
    promoted.mimeType !== expectedMimeType ||
    promoted.encryptionKeyReference !== configuration.kmsKeyArn
  ) {
    await markUploadFailed(attempt.id, UploadStatus.PROMOTING, UploadFailureStage.PROMOTION, UploadFailureCategory.PROMOTION_FAILURE, new Date())
    throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Durable object verification failed.")
  }
  try {
    const recorded = await recordVerifiedPromotion(attempt.id, {
      provider: StorageProvider.S3,
      bucket: promoted.bucket,
      objectKey: promoted.key,
      objectVersionId: promoted.versionId,
      etag: promoted.etag,
      checksumSha256: promoted.checksumSha256,
      sizeBytes: promoted.size,
      mimeType: promoted.mimeType,
      encryptionKeyRef: promoted.encryptionKeyReference,
      providerVerified: true,
      encryptionVerified: true,
      promotedAt: new Date(),
    })
    return { attempt: recorded, promoted }
  } catch (error) {
    await markUploadFailed(attempt.id, UploadStatus.PROMOTING, UploadFailureStage.PROMOTION, UploadFailureCategory.PROMOTION_FAILURE, new Date()).catch(() => undefined)
    throw error
  }
}
