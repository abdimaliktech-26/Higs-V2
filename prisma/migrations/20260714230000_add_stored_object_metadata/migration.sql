-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'S3');

-- CreateEnum
CREATE TYPE "StoredObjectLifecycleStatus" AS ENUM ('PENDING', 'QUARANTINED', 'AVAILABLE', 'FAILED', 'DELETION_PENDING', 'DELETED');

-- CreateEnum
CREATE TYPE "StoredObjectMalwareStatus" AS ENUM ('NOT_SCANNED', 'PENDING', 'CLEAN', 'INFECTED', 'ERROR');

-- AlterTable
ALTER TABLE "document_templates" ADD COLUMN "stored_object_id" TEXT;
ALTER TABLE "pdf_versions" ADD COLUMN "stored_object_id" TEXT;
ALTER TABLE "supporting_documents" ADD COLUMN "stored_object_id" TEXT;

-- CreateTable
CREATE TABLE "stored_objects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "StorageProvider" NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "object_version_id" TEXT,
    "etag" TEXT,
    "checksum_sha256" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "original_file_name" TEXT,
    "encryption_key_ref" TEXT,
    "lifecycle_status" "StoredObjectLifecycleStatus" NOT NULL DEFAULT 'PENDING',
    "malware_status" "StoredObjectMalwareStatus" NOT NULL DEFAULT 'NOT_SCANNED',
    "immutable" BOOLEAN NOT NULL DEFAULT false,
    "finalized_at" TIMESTAMP(3),
    "retention_until" TIMESTAMP(3),
    "legal_hold" BOOLEAN NOT NULL DEFAULT false,
    "deleted_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_templates_stored_object_id_key" ON "document_templates"("stored_object_id");
CREATE UNIQUE INDEX "pdf_versions_stored_object_id_key" ON "pdf_versions"("stored_object_id");
CREATE UNIQUE INDEX "supporting_documents_stored_object_id_key" ON "supporting_documents"("stored_object_id");
CREATE UNIQUE INDEX "stored_objects_provider_bucket_object_key_key" ON "stored_objects"("provider", "bucket", "object_key");
CREATE INDEX "stored_objects_organization_id_lifecycle_status_idx" ON "stored_objects"("organization_id", "lifecycle_status");
CREATE INDEX "stored_objects_organization_id_malware_status_idx" ON "stored_objects"("organization_id", "malware_status");
CREATE INDEX "stored_objects_deleted_at_idx" ON "stored_objects"("deleted_at");

-- AddForeignKey
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pdf_versions" ADD CONSTRAINT "pdf_versions_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "supporting_documents" ADD CONSTRAINT "supporting_documents_stored_object_id_fkey" FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
