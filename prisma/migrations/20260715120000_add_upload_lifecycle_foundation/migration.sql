-- PR-5B.1 is additive. Refuse the template-successor uniqueness change if
-- populated data contains two versions claiming the same predecessor.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "document_templates"
    WHERE "previous_version_id" IS NOT NULL
    GROUP BY "previous_version_id"
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'document template version chain contains multiple direct successors';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "UploadKind" AS ENUM ('TEMPLATE', 'TEMPLATE_VERSION', 'STAFF_SUPPORTING', 'PORTAL_REQUEST');

-- CreateEnum
CREATE TYPE "UploadStatus" AS ENUM ('INITIATED', 'RECEIVING', 'QUARANTINED', 'VALIDATING', 'VALIDATED', 'SCANNING', 'PROMOTING', 'PROMOTED', 'LINKING', 'LINKED_CLEANUP_PENDING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "UploadOwnerType" AS ENUM ('DOCUMENT_TEMPLATE', 'SUPPORTING_DOCUMENT');

-- CreateEnum
CREATE TYPE "UploadActorType" AS ENUM ('STAFF', 'PORTAL');

-- CreateEnum
CREATE TYPE "UploadFailureStage" AS ENUM ('AUTHORIZATION', 'RECEIVE', 'QUARANTINE', 'VALIDATION', 'SCAN', 'PROMOTION', 'LINKAGE', 'AUDIT', 'CLEANUP', 'INTERNAL');

-- CreateEnum
CREATE TYPE "UploadFailureCategory" AS ENUM ('AUTHORIZATION_REVOKED', 'SIZE_LIMIT', 'SIZE_MISMATCH', 'TYPE_MISMATCH', 'MALFORMED_CONTENT', 'ENCRYPTED_PDF', 'ACTIVE_CONTENT', 'SCAN_UNAVAILABLE', 'SCAN_INFECTED', 'SCAN_ERROR', 'STORAGE_FAILURE', 'PROMOTION_FAILURE', 'DATABASE_FAILURE', 'CONFLICT', 'REQUEST_CANCELLED', 'INTERNAL_FAILURE');

-- CreateEnum
CREATE TYPE "UploadCleanupStatus" AS ENUM ('NOT_REQUIRED', 'PENDING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "upload_attempts" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "upload_kind" "UploadKind" NOT NULL,
    "status" "UploadStatus" NOT NULL DEFAULT 'INITIATED',
    "intended_owner_type" "UploadOwnerType" NOT NULL,
    "intended_owner_id" TEXT NOT NULL,
    "parent_resource_id" TEXT,
    "actor_type" "UploadActorType" NOT NULL,
    "actor_identity_id" TEXT NOT NULL,
    "staff_user_id" TEXT,
    "portal_user_id" TEXT,
    "idempotency_key_hash" TEXT NOT NULL,
    "artifact_id" TEXT NOT NULL,
    "declared_mime_type" TEXT,
    "expected_size_bytes" BIGINT,
    "actual_size_bytes" BIGINT,
    "checksum_sha256" TEXT,
    "quarantine_provider" "StorageProvider",
    "quarantine_bucket" TEXT,
    "quarantine_object_key" TEXT,
    "quarantine_object_version_id" TEXT,
    "quarantine_etag" TEXT,
    "planned_durable_object_key" TEXT NOT NULL,
    "stored_object_id" TEXT,
    "malware_status" "StoredObjectMalwareStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "failure_stage" "UploadFailureStage",
    "failure_category" "UploadFailureCategory",
    "cleanup_status" "UploadCleanupStatus" NOT NULL DEFAULT 'NOT_REQUIRED',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "quarantined_at" TIMESTAMP(3),
    "validated_at" TIMESTAMP(3),
    "scanned_at" TIMESTAMP(3),
    "promoted_at" TIMESTAMP(3),
    "linked_at" TIMESTAMP(3),
    "cleanup_completed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "upload_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_previous_version_id_key" ON "document_templates"("previous_version_id");
CREATE UNIQUE INDEX "upload_attempts_stored_object_id_key" ON "upload_attempts"("stored_object_id");
CREATE UNIQUE INDEX "upload_attempts_idempotency_boundary_key" ON "upload_attempts"("organization_id", "actor_type", "actor_identity_id", "upload_kind", "idempotency_key_hash");
CREATE INDEX "upload_attempts_organization_id_status_idx" ON "upload_attempts"("organization_id", "status");
CREATE INDEX "upload_attempts_status_expires_at_idx" ON "upload_attempts"("status", "expires_at");
CREATE INDEX "upload_attempts_cleanup_status_idx" ON "upload_attempts"("cleanup_status");
CREATE INDEX "upload_attempts_createdAt_idx" ON "upload_attempts"("createdAt");

-- AddForeignKey
ALTER TABLE "upload_attempts" ADD CONSTRAINT "upload_attempts_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "upload_attempts" ADD CONSTRAINT "upload_attempts_staff_user_id_fkey" FOREIGN KEY ("staff_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "upload_attempts" ADD CONSTRAINT "upload_attempts_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "upload_attempts" ADD CONSTRAINT "upload_attempts_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
