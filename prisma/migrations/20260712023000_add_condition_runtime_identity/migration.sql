-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PACKET_CONDITION_SNAPSHOT_CREATED';

-- CreateEnum
CREATE TYPE "PacketDocumentApplicabilityStatus" AS ENUM ('ACTIVE', 'CONDITIONALLY_INACTIVE');

-- AlterTable
ALTER TABLE "packets"
  ADD COLUMN "condition_runtime_version" INTEGER,
  ADD COLUMN "condition_snapshot_id" TEXT;

-- AlterTable
ALTER TABLE "packet_documents"
  ADD COLUMN "packet_template_document_id" TEXT,
  ADD COLUMN "applicability_status" "PacketDocumentApplicabilityStatus" NOT NULL DEFAULT 'ACTIVE',
  ADD COLUMN "conditionally_inactive_at" TIMESTAMP(3),
  ADD COLUMN "conditionally_inactive_reason" TEXT;

-- AlterTable
ALTER TABLE "pdf_fields"
  ADD COLUMN "template_field_key" TEXT,
  ADD COLUMN "document_template_field_id" TEXT;

-- CreateTable
CREATE TABLE "packet_condition_snapshots" (
  "id" TEXT NOT NULL,
  "organization_id" TEXT NOT NULL,
  "packet_template_id" TEXT NOT NULL,
  "runtime_version" INTEGER NOT NULL DEFAULT 1,
  "evaluation_reference_at" TIMESTAMP(3) NOT NULL,
  "client_is_minor" BOOLEAN NOT NULL,
  "definition" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "packet_condition_snapshots_pkey" PRIMARY KEY ("id")
);

-- Root-owner/purpose uniqueness. PostgreSQL permits multiple NULL owner
-- values, so nested groups (all owner FKs NULL) remain unaffected.
CREATE UNIQUE INDEX "template_condition_groups_document_template_field_id_purpose_key"
  ON "template_condition_groups"("document_template_field_id", "purpose");
CREATE UNIQUE INDEX "template_condition_groups_packet_template_document_id_purpose_key"
  ON "template_condition_groups"("packet_template_document_id", "purpose");
CREATE UNIQUE INDEX "template_condition_groups_validation_rule_id_purpose_key"
  ON "template_condition_groups"("validation_rule_id", "purpose");

-- Runtime identity indexes. PostgreSQL's NULL-distinct unique semantics let
-- any number of legacy/manual NULL rows coexist safely.
CREATE UNIQUE INDEX "packets_condition_snapshot_id_key" ON "packets"("condition_snapshot_id");
CREATE UNIQUE INDEX "packet_documents_packet_id_packet_template_document_id_key"
  ON "packet_documents"("packet_id", "packet_template_document_id");
CREATE INDEX "packet_documents_packet_template_document_id_applicability_status_idx"
  ON "packet_documents"("packet_template_document_id", "applicability_status");
CREATE UNIQUE INDEX "pdf_fields_packet_document_id_template_field_key_key"
  ON "pdf_fields"("packet_document_id", "template_field_key");
CREATE INDEX "pdf_fields_document_template_field_id_idx" ON "pdf_fields"("document_template_field_id");
CREATE INDEX "packet_condition_snapshots_organization_id_packet_template_id_idx"
  ON "packet_condition_snapshots"("organization_id", "packet_template_id");

-- AddForeignKey
ALTER TABLE "packets" ADD CONSTRAINT "packets_condition_snapshot_id_fkey"
  FOREIGN KEY ("condition_snapshot_id") REFERENCES "packet_condition_snapshots"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "packet_documents" ADD CONSTRAINT "packet_documents_packet_template_document_id_fkey"
  FOREIGN KEY ("packet_template_document_id") REFERENCES "packet_template_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "pdf_fields" ADD CONSTRAINT "pdf_fields_document_template_field_id_fkey"
  FOREIGN KEY ("document_template_field_id") REFERENCES "document_template_fields"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "packet_condition_snapshots" ADD CONSTRAINT "packet_condition_snapshots_organization_id_fkey"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "packet_condition_snapshots" ADD CONSTRAINT "packet_condition_snapshots_packet_template_id_fkey"
  FOREIGN KEY ("packet_template_id") REFERENCES "packet_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
