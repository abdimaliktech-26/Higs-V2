-- AlterTable
ALTER TABLE "document_templates" ADD COLUMN     "previous_version_id" TEXT;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_previous_version_id_fkey" FOREIGN KEY ("previous_version_id") REFERENCES "document_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
