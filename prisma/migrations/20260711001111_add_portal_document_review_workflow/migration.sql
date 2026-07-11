-- CreateEnum
CREATE TYPE "PortalDocumentReviewOutcomeStatus" AS ENUM ('PENDING_REVIEW', 'UNDER_REVIEW', 'APPROVED', 'NEEDS_REPLACEMENT', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "PortalDocumentReviewCategory" AS ENUM ('PHOTO_QUALITY', 'UNREADABLE', 'MISSING_PAGES', 'WRONG_DOCUMENT', 'INCOMPLETE', 'EXPIRED', 'MISMATCHED_INFO', 'OTHER');

-- CreateEnum
CREATE TYPE "PortalDocumentReviewSeverity" AS ENUM ('REQUIRED', 'SUGGESTED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_DOCUMENT_REQUEST_UNDER_REVIEW';
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_DOCUMENT_REQUEST_REVIEWED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PortalDocumentTimelineEventType" ADD VALUE 'UNDER_REVIEW';
ALTER TYPE "PortalDocumentTimelineEventType" ADD VALUE 'APPROVED';
ALTER TYPE "PortalDocumentTimelineEventType" ADD VALUE 'NEEDS_REPLACEMENT';
ALTER TYPE "PortalDocumentTimelineEventType" ADD VALUE 'FEEDBACK_ADDED';

-- AlterTable
ALTER TABLE "supporting_documents" ADD COLUMN     "review_status" "PortalDocumentReviewOutcomeStatus";

-- CreateTable
CREATE TABLE "portal_document_review_feedback" (
    "id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "supporting_document_id" TEXT,
    "reviewer_user_id" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "category" "PortalDocumentReviewCategory" NOT NULL,
    "severity" "PortalDocumentReviewSeverity" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_document_review_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_document_review_feedback_request_id_createdAt_idx" ON "portal_document_review_feedback"("request_id", "createdAt");

-- AddForeignKey
ALTER TABLE "portal_document_review_feedback" ADD CONSTRAINT "portal_document_review_feedback_request_id_fkey" FOREIGN KEY ("request_id") REFERENCES "portal_document_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_review_feedback" ADD CONSTRAINT "portal_document_review_feedback_supporting_document_id_fkey" FOREIGN KEY ("supporting_document_id") REFERENCES "supporting_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_review_feedback" ADD CONSTRAINT "portal_document_review_feedback_reviewer_user_id_fkey" FOREIGN KEY ("reviewer_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
