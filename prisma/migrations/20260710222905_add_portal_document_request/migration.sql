-- CreateEnum
CREATE TYPE "PortalDocumentRequestStatus" AS ENUM ('PENDING', 'SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'NEEDS_REPLACEMENT', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PortalDocumentRequestPriority" AS ENUM ('LOW', 'NORMAL', 'HIGH');

-- CreateEnum
CREATE TYPE "PortalDocumentCategory" AS ENUM ('INSURANCE', 'IDENTIFICATION', 'MEDICATION', 'CARE_PLAN', 'LEGAL', 'CONSENT', 'PHOTO', 'OTHER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_DOCUMENT_REQUEST_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_DOCUMENT_REQUEST_CANCELLED';

-- CreateTable
CREATE TABLE "portal_document_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "packet_id" TEXT,
    "packet_document_id" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "PortalDocumentCategory" NOT NULL,
    "priority" "PortalDocumentRequestPriority" NOT NULL DEFAULT 'NORMAL',
    "is_required" BOOLEAN NOT NULL DEFAULT true,
    "due_date" TIMESTAMP(3),
    "status" "PortalDocumentRequestStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by_user_id" TEXT NOT NULL,
    "cancelled_at" TIMESTAMP(3),
    "cancelled_by_user_id" TEXT,
    "cancellation_reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_document_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "portal_document_requests_organization_id_client_id_status_idx" ON "portal_document_requests"("organization_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "portal_document_requests_client_id_status_idx" ON "portal_document_requests"("client_id", "status");

-- CreateIndex
CREATE INDEX "portal_document_requests_due_date_idx" ON "portal_document_requests"("due_date");

-- AddForeignKey
ALTER TABLE "portal_document_requests" ADD CONSTRAINT "portal_document_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_requests" ADD CONSTRAINT "portal_document_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_requests" ADD CONSTRAINT "portal_document_requests_packet_id_fkey" FOREIGN KEY ("packet_id") REFERENCES "packets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_requests" ADD CONSTRAINT "portal_document_requests_packet_document_id_fkey" FOREIGN KEY ("packet_document_id") REFERENCES "packet_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_requests" ADD CONSTRAINT "portal_document_requests_requested_by_user_id_fkey" FOREIGN KEY ("requested_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_document_requests" ADD CONSTRAINT "portal_document_requests_cancelled_by_user_id_fkey" FOREIGN KEY ("cancelled_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
