-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PACKET_DOCUMENT_INITIAL_APPLICABILITY_SET';

-- RenameIndex
ALTER INDEX "packet_condition_snapshots_organization_id_packet_template_id_i" RENAME TO "packet_condition_snapshots_organization_id_packet_template__idx";

-- RenameIndex
ALTER INDEX "packet_documents_packet_template_document_id_applicability_stat" RENAME TO "packet_documents_packet_template_document_id_applicability__idx";

-- RenameIndex
ALTER INDEX "template_condition_groups_document_template_field_id_purpose_ke" RENAME TO "template_condition_groups_document_template_field_id_purpos_key";

-- RenameIndex
ALTER INDEX "template_condition_groups_packet_template_document_id_purpose_k" RENAME TO "template_condition_groups_packet_template_document_id_purpo_key";
