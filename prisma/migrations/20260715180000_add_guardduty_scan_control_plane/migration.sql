-- PR-5B.2A adds only version-bound scanner-event identity. No active writer is
-- migrated and no existing upload or storage row is modified or backfilled.

-- CreateEnum
CREATE TYPE "UploadScannerProvider" AS ENUM ('GUARDDUTY_S3');

-- AlterTable
ALTER TABLE "upload_attempts"
ADD COLUMN "scanner_provider" "UploadScannerProvider",
ADD COLUMN "scanner_reference" TEXT,
ADD COLUMN "scan_requested_at" TIMESTAMP(3),
ADD COLUMN "scan_result_received_at" TIMESTAMP(3);

-- CreateIndex
CREATE UNIQUE INDEX "upload_attempts_scanner_reference_key"
ON "upload_attempts"("scanner_provider", "scanner_reference");

-- PostgreSQL permits multiple NULL tuples, while populated quarantine object
-- identities are unique and therefore resolve to exactly one attempt.
CREATE UNIQUE INDEX "upload_attempts_quarantine_object_identity_key"
ON "upload_attempts"("quarantine_provider", "quarantine_bucket", "quarantine_object_key", "quarantine_object_version_id");
