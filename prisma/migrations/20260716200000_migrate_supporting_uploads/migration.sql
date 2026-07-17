-- PR-5B.3 carries non-file supporting-document metadata across the
-- asynchronous quarantine and GuardDuty scan boundary for staff supporting
-- and portal request uploads, and records the deep-validation-detected MIME
-- type on the upload attempt. This migration is additive only; it does not
-- backfill supporting documents, upload attempts, or stored objects.

ALTER TABLE "upload_attempts" ADD COLUMN "validated_mime_type" TEXT;

CREATE TABLE "supporting_upload_intents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "upload_attempt_id" TEXT NOT NULL,
    "supporting_document_id" TEXT NOT NULL,
    "client_id" TEXT,
    "packet_id" TEXT,
    "portal_request_id" TEXT,
    "title" TEXT,
    "category" TEXT,
    "description" TEXT,
    "original_file_name" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supporting_upload_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "supporting_upload_intents_upload_attempt_id_key"
ON "supporting_upload_intents"("upload_attempt_id");

CREATE UNIQUE INDEX "supporting_upload_intents_supporting_document_id_key"
ON "supporting_upload_intents"("supporting_document_id");

CREATE INDEX "supporting_upload_intents_organization_id_createdAt_idx"
ON "supporting_upload_intents"("organization_id", "createdAt");

CREATE INDEX "supporting_upload_intents_portal_request_id_idx"
ON "supporting_upload_intents"("portal_request_id");

ALTER TABLE "supporting_upload_intents"
ADD CONSTRAINT "supporting_upload_intents_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "supporting_upload_intents"
ADD CONSTRAINT "supporting_upload_intents_upload_attempt_id_fkey"
FOREIGN KEY ("upload_attempt_id") REFERENCES "upload_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
