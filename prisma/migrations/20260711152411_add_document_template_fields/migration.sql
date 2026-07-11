-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TEMPLATE_FIELD_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TEMPLATE_FIELD_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TEMPLATE_FIELD_DELETED';

-- CreateTable
CREATE TABLE "document_template_fields" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_template_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "field_type" TEXT NOT NULL DEFAULT 'text',
    "page_number" INTEGER NOT NULL DEFAULT 1,
    "pos_x" DOUBLE PRECISION,
    "pos_y" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "is_required" BOOLEAN NOT NULL DEFAULT false,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_template_fields_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "document_template_fields_document_template_id_field_key_key" ON "document_template_fields"("document_template_id", "field_key");

-- AddForeignKey
ALTER TABLE "document_template_fields" ADD CONSTRAINT "document_template_fields_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_template_fields" ADD CONSTRAINT "document_template_fields_document_template_id_fkey" FOREIGN KEY ("document_template_id") REFERENCES "document_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
