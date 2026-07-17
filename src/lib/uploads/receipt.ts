import "server-only"

import { extname } from "node:path"
import { Readable } from "node:stream"
import {
  StorageProvider,
  UploadFailureCategory,
  UploadFailureStage,
  UploadScannerProvider,
  UploadStatus,
  type UploadAttempt,
} from "@prisma/client"
import { readStorageConfiguration, storageKeys, type StorageAdapter } from "../storage/index"
import { readUploadScannerConfiguration } from "./config"
import { UploadLifecycleError, UploadValidationError } from "./errors"
import {
  beginEventDrivenScanning,
  beginReceiving,
  beginValidation,
  markUploadFailed,
  recordQuarantined,
  recordValidated,
} from "./lifecycle"
import { getUploadValidationProfile } from "./profiles"
import { withUploadSpool } from "./stream"
import { validateUpload } from "./validation"

export class UploadRuntimeUnavailableError extends Error {
  constructor() {
    super("Secure uploads are temporarily unavailable.")
    this.name = "UploadRuntimeUnavailableError"
  }
}

export function asDatabaseProvider(provider: StorageAdapter["provider"]): StorageProvider {
  if (provider !== "s3") throw new UploadRuntimeUnavailableError()
  return StorageProvider.S3
}

/** Active migrated writers require the complete S3 + GuardDuty operating gate in every environment. */
export function assertUploadRuntimeAvailable(): void {
  const storage = readStorageConfiguration()
  const scanner = readUploadScannerConfiguration()
  if (
    storage.provider !== "s3" ||
    !storage.region ||
    !storage.durableBucket ||
    !storage.quarantineBucket ||
    !storage.kmsKeyArn ||
    scanner.provider !== "guardduty-s3" ||
    scanner.errors.length > 0 ||
    !scanner.operationallyApproved ||
    !scanner.platformLimitsVerified
  ) {
    throw new UploadRuntimeUnavailableError()
  }
}

function safeFailure(error: unknown): { stage: UploadFailureStage; category: UploadFailureCategory } {
  if (error instanceof UploadValidationError) {
    return { stage: UploadFailureStage.VALIDATION, category: error.failureCategory ?? UploadFailureCategory.MALFORMED_CONTENT }
  }
  return { stage: UploadFailureStage.QUARANTINE, category: UploadFailureCategory.STORAGE_FAILURE }
}

/**
 * Shared receipt path for every migrated writer: stream once through the
 * bounded spool into the quarantine bucket, deep-validate the spool against
 * the attempt's profile, persist the detected MIME type, and stop at
 * SCANNING for the event-driven GuardDuty result. Any failure marks the
 * attempt FAILED at the stage it reached and rethrows.
 */
export async function receiveValidateAndBeginScan(input: {
  attempt: UploadAttempt
  file: File
  adapter: StorageAdapter
  quarantineMimeType: string
}): Promise<void> {
  const { attempt, file, adapter } = input
  let current: UploadStatus = UploadStatus.INITIATED
  try {
    await beginReceiving(attempt.id)
    current = UploadStatus.RECEIVING
    const quarantineKey = storageKeys.quarantine({
      organizationId: attempt.organizationId,
      uploadAttemptId: attempt.id,
      artifactId: attempt.artifactId,
    })
    const profile = getUploadValidationProfile(attempt.uploadKind)
    await withUploadSpool(
      {
        stream: Readable.fromWeb(file.stream() as never),
        maxBytes: profile.maxBytes,
        declaredSize: file.size,
      },
      async (spool) => {
        const quarantined = await adapter.putObject({
          key: quarantineKey,
          location: "quarantine",
          body: spool.openStream(),
          expectedContentLength: spool.size,
          mimeType: input.quarantineMimeType,
          checksumSha256: spool.checksumSha256,
          encryption: { mode: "sse-kms" },
          preconditions: { ifNoneMatch: true },
          metadata: { uploadAttemptId: attempt.id },
        })
        if (!quarantined.versionId || !quarantined.etag) {
          throw new UploadLifecycleError("INTEGRITY_MISMATCH", "Quarantine storage did not return version-bound identity.")
        }
        await recordQuarantined(attempt.id, {
          provider: asDatabaseProvider(adapter.provider),
          bucket: quarantined.bucket,
          objectKey: quarantined.key,
          objectVersionId: quarantined.versionId,
          etag: quarantined.etag,
          actualSizeBytes: spool.size,
          checksumSha256: spool.checksumSha256,
          quarantinedAt: new Date(),
        })
        current = UploadStatus.QUARANTINED
        await beginValidation(attempt.id)
        current = UploadStatus.VALIDATING
        const validation = await validateUpload({
          source: spool,
          extension: extname(file.name),
          declaredMimeType: file.type,
          policy: profile,
        })
        await recordValidated(attempt.id, new Date(), undefined, validation.detectedMimeType)
        current = UploadStatus.VALIDATED
      },
    )
    await beginEventDrivenScanning(attempt.id, UploadScannerProvider.GUARDDUTY_S3, new Date())
  } catch (error) {
    const failure = safeFailure(error)
    await markUploadFailed(attempt.id, current as Exclude<UploadStatus, "COMPLETED" | "FAILED">, failure.stage, failure.category, new Date()).catch(() => undefined)
    throw error
  }
}
