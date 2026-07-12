-- CreateEnum
CREATE TYPE "ConditionPurpose" AS ENUM ('FIELD_VISIBILITY', 'FIELD_REQUIREDNESS', 'DOCUMENT_INCLUSION', 'DOCUMENT_REQUIREDNESS', 'VALIDATION_RULE_APPLICABILITY');

-- CreateEnum
CREATE TYPE "ConditionLogicOperator" AS ENUM ('AND', 'OR');

-- CreateEnum
CREATE TYPE "ConditionOperator" AS ENUM ('EQUALS', 'NOT_EQUALS', 'CONTAINS', 'NOT_EMPTY', 'EMPTY', 'CHECKED', 'UNCHECKED', 'GREATER_THAN', 'LESS_THAN', 'BEFORE', 'AFTER', 'IN', 'NOT_IN');

-- CreateEnum
CREATE TYPE "ConditionSourceType" AS ENUM ('TEMPLATE_FIELD', 'CLIENT_IS_MINOR', 'PACKET_PROGRAM_CODE', 'PACKET_TYPE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'TEMPLATE_CONDITION_CREATED';
ALTER TYPE "AuditAction" ADD VALUE 'TEMPLATE_CONDITION_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE 'TEMPLATE_CONDITION_DELETED';

-- CreateTable
CREATE TABLE "template_condition_groups" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "purpose" "ConditionPurpose" NOT NULL,
    "logic_operator" "ConditionLogicOperator" NOT NULL DEFAULT 'AND',
    "parent_group_id" TEXT,
    "document_template_field_id" TEXT,
    "packet_template_document_id" TEXT,
    "validation_rule_id" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_condition_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_conditions" (
    "id" TEXT NOT NULL,
    "group_id" TEXT NOT NULL,
    "source_type" "ConditionSourceType" NOT NULL,
    "source_field_key" TEXT,
    "operator" "ConditionOperator" NOT NULL,
    "comparison_value" JSONB,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "template_conditions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "template_condition_groups_document_template_field_id_idx" ON "template_condition_groups"("document_template_field_id");

-- CreateIndex
CREATE INDEX "template_condition_groups_parent_group_id_idx" ON "template_condition_groups"("parent_group_id");

-- CreateIndex
CREATE INDEX "template_conditions_group_id_idx" ON "template_conditions"("group_id");

-- CreateIndex
CREATE INDEX "template_conditions_source_field_key_idx" ON "template_conditions"("source_field_key");

-- AddForeignKey
ALTER TABLE "template_condition_groups" ADD CONSTRAINT "template_condition_groups_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_condition_groups" ADD CONSTRAINT "template_condition_groups_parent_group_id_fkey" FOREIGN KEY ("parent_group_id") REFERENCES "template_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_condition_groups" ADD CONSTRAINT "template_condition_groups_document_template_field_id_fkey" FOREIGN KEY ("document_template_field_id") REFERENCES "document_template_fields"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_condition_groups" ADD CONSTRAINT "template_condition_groups_packet_template_document_id_fkey" FOREIGN KEY ("packet_template_document_id") REFERENCES "packet_template_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_condition_groups" ADD CONSTRAINT "template_condition_groups_validation_rule_id_fkey" FOREIGN KEY ("validation_rule_id") REFERENCES "validation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_conditions" ADD CONSTRAINT "template_conditions_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "template_condition_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;
