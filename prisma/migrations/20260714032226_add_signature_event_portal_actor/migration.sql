-- AlterTable
ALTER TABLE "signature_events" ADD COLUMN     "portal_user_id" TEXT;

-- AddForeignKey
ALTER TABLE "signature_events" ADD CONSTRAINT "signature_events_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
