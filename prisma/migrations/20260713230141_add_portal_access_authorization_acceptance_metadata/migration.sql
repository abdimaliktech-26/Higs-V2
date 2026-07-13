-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_ACCESS_AUTHORIZATION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_ACCESS_AUTHORIZATION_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE 'PORTAL_ACCESS_SIGN_PERMISSION_CHANGED';

-- AlterTable
ALTER TABLE "portal_access_authorizations" ADD COLUMN     "accepted_ip" TEXT,
ADD COLUMN     "accepted_user_agent" TEXT;
