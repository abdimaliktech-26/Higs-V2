-- CreateEnum
CREATE TYPE "PortalUserStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'LOCKED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "PortalAccessRole" AS ENUM ('CLIENT_SELF', 'GUARDIAN', 'PARENT', 'RESPONSIBLE_PARTY', 'AUTHORIZED_REPRESENTATIVE');

-- CreateEnum
CREATE TYPE "PortalAccessStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PortalInvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "PortalAuthorityType" AS ENUM ('LEGAL_GUARDIAN', 'PARENT_OF_MINOR', 'POWER_OF_ATTORNEY', 'CONSERVATOR', 'SELF', 'ORG_DESIGNATED');

-- CreateEnum
CREATE TYPE "PortalDocumentAccessLevel" AS ENUM ('VIEW', 'VIEW_AND_DOWNLOAD');

-- CreateEnum
CREATE TYPE "PortalAuditAction" AS ENUM ('PORTAL_LOGIN_SUCCESS', 'PORTAL_LOGIN_FAILED', 'PORTAL_INVITATION_SENT', 'PORTAL_INVITATION_ACCEPTED', 'PORTAL_INVITATION_REVOKED', 'PORTAL_ACCESS_GRANTED', 'PORTAL_ACCESS_REVOKED', 'PORTAL_DOCUMENT_VIEWED', 'PORTAL_DOCUMENT_DOWNLOADED', 'PORTAL_DOCUMENT_UPLOADED', 'PORTAL_SIGNATURE_VIEWED', 'PORTAL_SIGNATURE_SIGNED', 'PORTAL_SIGNATURE_DECLINED', 'PORTAL_PERMISSION_CHANGED', 'PORTAL_CONSENT_ACCEPTED', 'PORTAL_CONSENT_REVOKED', 'PORTAL_SESSION_REVOKED', 'PORTAL_EMAIL_VERIFIED', 'PORTAL_PASSWORD_RESET', 'PORTAL_EMAIL_CHANGED');

-- AlterTable
ALTER TABLE "packet_documents" ADD COLUMN     "portal_access_level" "PortalDocumentAccessLevel",
ADD COLUMN     "portal_visible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portal_visible_at" TIMESTAMP(3),
ADD COLUMN     "shared_by_user_id" TEXT;

-- AlterTable
ALTER TABLE "signature_requests" ADD COLUMN     "access_grant_id" TEXT,
ADD COLUMN     "client_contact_id" TEXT,
ADD COLUMN     "portal_user_id" TEXT;

-- AlterTable
ALTER TABLE "supporting_documents" ADD COLUMN     "portal_access_level" "PortalDocumentAccessLevel",
ADD COLUMN     "portal_visible" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "portal_visible_at" TIMESTAMP(3),
ADD COLUMN     "shared_by_user_id" TEXT;

-- CreateTable
CREATE TABLE "portal_users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "password_hash" TEXT,
    "email_verified_at" TIMESTAMP(3),
    "phone_verified_at" TIMESTAMP(3),
    "status" "PortalUserStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "last_login_at" TIMESTAMP(3),
    "failed_login_count" INTEGER NOT NULL DEFAULT 0,
    "locked_until" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_sessions" (
    "id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "ip_at_login" TEXT,
    "user_agent" TEXT,
    "expires" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_email_verification_tokens" (
    "id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_email_verification_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_password_reset_tokens" (
    "id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "request_ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_email_change_tokens" (
    "id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "new_email" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_email_change_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_client_access" (
    "id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_contact_id" TEXT,
    "relationship" TEXT NOT NULL,
    "access_role" "PortalAccessRole" NOT NULL,
    "status" "PortalAccessStatus" NOT NULL DEFAULT 'ACTIVE',
    "granted_by_user_id" TEXT NOT NULL,
    "granted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "revocation_reason" TEXT,
    "can_view_documents" BOOLEAN NOT NULL DEFAULT false,
    "can_upload_documents" BOOLEAN NOT NULL DEFAULT false,
    "can_sign_documents" BOOLEAN NOT NULL DEFAULT false,
    "can_view_appointments" BOOLEAN NOT NULL DEFAULT false,
    "can_message_care_team" BOOLEAN NOT NULL DEFAULT false,
    "can_manage_other_guardians" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "portal_client_access_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_invitations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "client_contact_id" TEXT,
    "invited_email" TEXT NOT NULL,
    "invited_by_user_id" TEXT NOT NULL,
    "access_role" "PortalAccessRole" NOT NULL,
    "requested_permissions" JSONB NOT NULL DEFAULT '{}',
    "token_hash" TEXT NOT NULL,
    "status" "PortalInvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "accepted_by_portal_user_id" TEXT,
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_access_authorizations" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "access_grant_id" TEXT NOT NULL,
    "granted_by_user_id" TEXT NOT NULL,
    "authority_type" "PortalAuthorityType" NOT NULL,
    "scope" JSONB NOT NULL DEFAULT '{}',
    "effective_date" TIMESTAMP(3) NOT NULL,
    "expiration_date" TIMESTAMP(3),
    "supporting_document_id" TEXT,
    "consent_text" TEXT NOT NULL,
    "consent_version" TEXT NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_by_user_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_access_authorizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_notifications" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "portal_user_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "link" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "read_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "portal_audit_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "portal_user_id" TEXT,
    "client_id" TEXT,
    "action" "PortalAuditAction" NOT NULL,
    "target_type" TEXT,
    "target_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ip_address" TEXT,
    "user_agent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "portal_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "portal_users_email_key" ON "portal_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "portal_sessions_session_token_hash_key" ON "portal_sessions"("session_token_hash");

-- CreateIndex
CREATE INDEX "portal_sessions_portal_user_id_expires_idx" ON "portal_sessions"("portal_user_id", "expires");

-- CreateIndex
CREATE UNIQUE INDEX "portal_email_verification_tokens_token_hash_key" ON "portal_email_verification_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "portal_email_verification_tokens_portal_user_id_idx" ON "portal_email_verification_tokens"("portal_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_password_reset_tokens_token_hash_key" ON "portal_password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "portal_password_reset_tokens_portal_user_id_idx" ON "portal_password_reset_tokens"("portal_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "portal_email_change_tokens_token_hash_key" ON "portal_email_change_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "portal_email_change_tokens_portal_user_id_idx" ON "portal_email_change_tokens"("portal_user_id");

-- CreateIndex
CREATE INDEX "portal_client_access_portal_user_id_client_id_status_idx" ON "portal_client_access"("portal_user_id", "client_id", "status");

-- CreateIndex
CREATE INDEX "portal_client_access_client_id_status_idx" ON "portal_client_access"("client_id", "status");

-- CreateIndex
CREATE INDEX "portal_client_access_organization_id_status_idx" ON "portal_client_access"("organization_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "portal_invitations_token_hash_key" ON "portal_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "portal_invitations_invited_email_status_idx" ON "portal_invitations"("invited_email", "status");

-- CreateIndex
CREATE INDEX "portal_invitations_organization_id_client_id_idx" ON "portal_invitations"("organization_id", "client_id");

-- CreateIndex
CREATE INDEX "portal_invitations_expires_at_idx" ON "portal_invitations"("expires_at");

-- CreateIndex
CREATE INDEX "portal_access_authorizations_client_id_portal_user_id_idx" ON "portal_access_authorizations"("client_id", "portal_user_id");

-- CreateIndex
CREATE INDEX "portal_access_authorizations_access_grant_id_idx" ON "portal_access_authorizations"("access_grant_id");

-- CreateIndex
CREATE INDEX "portal_notifications_portal_user_id_read_at_idx" ON "portal_notifications"("portal_user_id", "read_at");

-- CreateIndex
CREATE INDEX "portal_notifications_client_id_idx" ON "portal_notifications"("client_id");

-- CreateIndex
CREATE INDEX "portal_audit_events_organization_id_createdAt_idx" ON "portal_audit_events"("organization_id", "createdAt");

-- CreateIndex
CREATE INDEX "portal_audit_events_portal_user_id_idx" ON "portal_audit_events"("portal_user_id");

-- CreateIndex
CREATE INDEX "portal_audit_events_client_id_createdAt_idx" ON "portal_audit_events"("client_id", "createdAt");

-- CreateIndex
CREATE INDEX "portal_audit_events_action_idx" ON "portal_audit_events"("action");

-- AddForeignKey
ALTER TABLE "packet_documents" ADD CONSTRAINT "packet_documents_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_client_contact_id_fkey" FOREIGN KEY ("client_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "signature_requests" ADD CONSTRAINT "signature_requests_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "portal_client_access"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supporting_documents" ADD CONSTRAINT "supporting_documents_shared_by_user_id_fkey" FOREIGN KEY ("shared_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_sessions" ADD CONSTRAINT "portal_sessions_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_email_verification_tokens" ADD CONSTRAINT "portal_email_verification_tokens_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_password_reset_tokens" ADD CONSTRAINT "portal_password_reset_tokens_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_email_change_tokens" ADD CONSTRAINT "portal_email_change_tokens_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_client_contact_id_fkey" FOREIGN KEY ("client_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_client_access" ADD CONSTRAINT "portal_client_access_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_client_contact_id_fkey" FOREIGN KEY ("client_contact_id") REFERENCES "client_contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_invitations" ADD CONSTRAINT "portal_invitations_accepted_by_portal_user_id_fkey" FOREIGN KEY ("accepted_by_portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_authorizations" ADD CONSTRAINT "portal_access_authorizations_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_authorizations" ADD CONSTRAINT "portal_access_authorizations_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_authorizations" ADD CONSTRAINT "portal_access_authorizations_access_grant_id_fkey" FOREIGN KEY ("access_grant_id") REFERENCES "portal_client_access"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_authorizations" ADD CONSTRAINT "portal_access_authorizations_granted_by_user_id_fkey" FOREIGN KEY ("granted_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_authorizations" ADD CONSTRAINT "portal_access_authorizations_revoked_by_user_id_fkey" FOREIGN KEY ("revoked_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_access_authorizations" ADD CONSTRAINT "portal_access_authorizations_supporting_document_id_fkey" FOREIGN KEY ("supporting_document_id") REFERENCES "supporting_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_notifications" ADD CONSTRAINT "portal_notifications_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_notifications" ADD CONSTRAINT "portal_notifications_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_notifications" ADD CONSTRAINT "portal_notifications_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_audit_events" ADD CONSTRAINT "portal_audit_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_audit_events" ADD CONSTRAINT "portal_audit_events_portal_user_id_fkey" FOREIGN KEY ("portal_user_id") REFERENCES "portal_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "portal_audit_events" ADD CONSTRAINT "portal_audit_events_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Partial unique index: only one ACTIVE, non-revoked access grant may exist
-- per portal user/client pair at a time. Historical (revoked/expired/superseded)
-- grants are preserved and are NOT covered by this constraint, so re-granting
-- access after revocation is not blocked. Prisma's schema DSL has no partial/
-- filtered unique index support, so this is hand-added directly to the migration.
CREATE UNIQUE INDEX "portal_client_access_one_active" ON "portal_client_access" ("portal_user_id", "client_id") WHERE "status" = 'ACTIVE' AND "revoked_at" IS NULL;
