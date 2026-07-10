-- CreateEnum
CREATE TYPE "PortalDocumentTimelineEventType" AS ENUM ('REQUESTED', 'UPLOADED', 'RESUBMITTED', 'CANCELLED');

-- AlterEnum
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_ACCESS_UPLOAD_PERMISSION_CHANGED';

-- DropForeignKey
ALTER TABLE "supporting_documents" DROP CONSTRAINT "supporting_documents_uploaded_by_id_fkey";

-- AlterTable
ALTER TABLE "supporting_documents" ADD COLUMN     "original_file_name" TEXT,
ADD COLUMN     "portal_request_id" TEXT,
ADD COLUMN     "uploaded_by_portal_user_id" TEXT,
ALTER COLUMN "uploaded_by_id" DROP NOT NULL;

-- CreateTable
CREATE TABLE "portal_document_timeline_events" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "eventType" "PortalDocumentTimelineEventType" NOT NULL,
    "supporting_document_id" TEXT,
    "created_by_portal_user_id" TEXT,
    "created_by_user_id" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_document_timeline_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_document_timeline_events_request_id_createdAt_idx" ON "portal_document_timeline_events"("request_id", "createdAt");

-- CreateIndex
CREATE INDEX "supporting_documents_portal_request_id_idx" ON "supporting_documents"("portal_request_id");

-- AddForeignKey
ALTER TABLE "supporting_documents" ADD CONSTRAINT "supporting_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supporting_documents" ADD CONSTRAINT "supporting_documents_uploaded_by_portal_user_id_fkey" FOREIGN KEY ("uploaded_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supporting_documents" ADD CONSTRAINT "supporting_documents_portal_request_id_fkey" FOREIGN KEY ("portal_request_id") REFERENCES "portal_document_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_timeline_events" ADD CONSTRAINT "portal_document_timeline_events_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "portal_document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_timeline_events" ADD CONSTRAINT "portal_document_timeline_events_supporting_document_id_fkey" FOREIGN KEY ("supporting_document_id") REFERENCES "supporting_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_timeline_events" ADD CONSTRAINT "portal_document_timeline_events_created_by_portal_user_id_fkey" FOREIGN KEY ("created_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_timeline_events" ADD CONSTRAINT "portal_document_timeline_events_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
