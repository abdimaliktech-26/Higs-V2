-- AlterTable
ALTER TABLE "template_conditions" ADD COLUMN     "source_packet_template_document_id" TEXT;

-- CreateIndex
CREATE INDEX "template_conditions_source_packet_template_document_id_idx" ON "template_conditions"("source_packet_template_document_id");

-- AddForeignKey
ALTER TABLE "template_conditions" ADD CONSTRAINT "template_conditions_source_packet_template_document_id_fkey" FOREIGN KEY ("source_packet_template_document_id") REFERENCES "packet_template_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
