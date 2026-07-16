-- PR-5B.2B carries non-file template metadata across the asynchronous
-- quarantine and GuardDuty scan boundary. This migration is additive only;
-- it does not backfill templates, upload attempts, or stored objects.

CREATE TABLE "template_upload_intents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "upload_attempt_id" TEXT NOT NULL,
    "document_template_id" TEXT NOT NULL,
    "previous_version_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "form_type" TEXT NOT NULL,
    "program" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_upload_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "template_upload_intents_upload_attempt_id_key"
ON "template_upload_intents"("upload_attempt_id");

CREATE UNIQUE INDEX "template_upload_intents_document_template_id_key"
ON "template_upload_intents"("document_template_id");

CREATE INDEX "template_upload_intents_organization_id_createdAt_idx"
ON "template_upload_intents"("organization_id", "createdAt");

CREATE INDEX "template_upload_intents_previous_version_id_idx"
ON "template_upload_intents"("previous_version_id");

ALTER TABLE "template_upload_intents"
ADD CONSTRAINT "template_upload_intents_organization_id_fkey"
FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "template_upload_intents"
ADD CONSTRAINT "template_upload_intents_upload_attempt_id_fkey"
FOREIGN KEY ("upload_attempt_id") REFERENCES "upload_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
