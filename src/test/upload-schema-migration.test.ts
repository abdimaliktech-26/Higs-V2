import fs from "node:fs/promises"
import path from "node:path"
import { describe, expect, it } from "vitest"

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma")
const migrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260715120000_add_upload_lifecycle_foundation",
  "migration.sql",
)
const scannerMigrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260715180000_add_guardduty_scan_control_plane",
  "migration.sql",
)
const templateMigrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260716120000_migrate_template_uploads",
  "migration.sql",
)
const supportingMigrationPath = path.join(
  process.cwd(),
  "prisma",
  "migrations",
  "20260716200000_migrate_supporting_uploads",
  "migration.sql",
)

describe("PR-5B.1 additive upload lifecycle schema", () => {
  it("adds bounded UploadAttempt state, actors, lifecycle metadata, and indexes", async () => {
    const schema = await fs.readFile(schemaPath, "utf8")
    const block = schema.slice(schema.indexOf("model UploadAttempt {"), schema.indexOf("model TemplateUploadIntent {"))
    expect(block).toContain("idempotencyKeyHash")
    expect(block).toContain("actorIdentityId")
    expect(block).toContain("quarantineObjectKey")
    expect(block).toContain("plannedDurableObjectKey")
    expect(block).toContain("storedObjectId")
    expect(block).not.toContain("originalFileName")
    expect(block).not.toContain("ipAddress")
    expect(block).not.toContain("rawProvider")
    expect(schema).toContain("@@unique([organizationId, actorType, actorIdentityId, uploadKind, idempotencyKeyHash]")
  })

  it("uses a compatibility-safe actor uniqueness boundary and one template successor", async () => {
    const schema = await fs.readFile(schemaPath, "utf8")
    expect(schema).toMatch(/previousVersionId\s+String\?\s+@unique @map\("previous_version_id"\)/)
    expect(schema).toContain("staffUserId")
    expect(schema).toContain("portalUserId")
    expect(schema).toContain("actorIdentityId")
  })

  it("is additive, preflights existing successors, and creates no lifecycle rows or backfill", async () => {
    const migration = await fs.readFile(migrationPath, "utf8")
    expect(migration).toContain('CREATE TABLE "upload_attempts"')
    expect(migration).toContain('HAVING COUNT(*) > 1')
    expect(migration).toContain('CREATE UNIQUE INDEX "document_templates_previous_version_id_key"')
    expect(migration).not.toMatch(/\bINSERT\b/i)
    expect(migration).not.toMatch(/^\s*UPDATE\s/im)
    expect(migration).not.toContain('ALTER TABLE "stored_objects"')
    expect(migration).not.toContain('ALTER TABLE "document_templates" ADD COLUMN')
    expect(migration).not.toContain('ALTER TABLE "supporting_documents" ADD COLUMN')
    expect(migration).not.toContain('ALTER TABLE "pdf_versions" ADD COLUMN')
  })
})

describe("PR-5B.2A additive scanner control-plane schema", () => {
  it("adds bounded scanner evidence and unique version-bound event/object identity", async () => {
    const schema = await fs.readFile(schemaPath, "utf8")
    const block = schema.slice(schema.indexOf("model UploadAttempt {"), schema.indexOf("model TemplateUploadIntent {"))
    expect(schema).toContain("enum UploadScannerProvider")
    expect(block).toContain("scannerProvider")
    expect(block).toContain("scannerReference")
    expect(block).toContain("scanRequestedAt")
    expect(block).toContain("scanResultReceivedAt")
    expect(block).toContain("upload_attempts_scanner_reference_key")
    expect(block).toContain("upload_attempts_quarantine_object_identity_key")
  })

  it("is additive and does not modify or backfill existing lifecycle rows", async () => {
    const migration = await fs.readFile(scannerMigrationPath, "utf8")
    expect(migration).toContain('ALTER TABLE "upload_attempts"')
    expect(migration).toContain('CREATE TYPE "UploadScannerProvider"')
    expect(migration).not.toMatch(/\bINSERT\b/i)
    expect(migration).not.toMatch(/^\s*UPDATE\s/im)
    expect(migration).not.toContain('ALTER TABLE "stored_objects"')
    expect(migration).not.toContain('ALTER TABLE "document_templates"')
  })
})

describe("PR-5B.2B additive template upload intent schema", () => {
  it("keeps template metadata separate from the PHI-free UploadAttempt", async () => {
    const schema = await fs.readFile(schemaPath, "utf8")
    const attemptBlock = schema.slice(schema.indexOf("model UploadAttempt {"), schema.indexOf("model TemplateUploadIntent {"))
    const intentBlock = schema.slice(schema.indexOf("model TemplateUploadIntent {"), schema.indexOf("model SupportingUploadIntent {"))
    expect(attemptBlock).not.toContain("originalFileName")
    expect(attemptBlock).not.toContain("documentTitle")
    expect(intentBlock).toContain("uploadAttemptId")
    expect(intentBlock).toContain("documentTemplateId")
    expect(intentBlock).toContain("previousVersionId")
    expect(intentBlock).not.toContain("originalFileName")
  })

  it("is additive and performs no backfill or owner/storage mutation", async () => {
    const migration = await fs.readFile(templateMigrationPath, "utf8")
    expect(migration).toContain('CREATE TABLE "template_upload_intents"')
    expect(migration).not.toMatch(/\bINSERT\b/i)
    expect(migration).not.toMatch(/^\s*UPDATE\s/im)
    expect(migration).not.toContain('ALTER TABLE "document_templates"')
    expect(migration).not.toContain('ALTER TABLE "stored_objects"')
    expect(migration).not.toContain('ALTER TABLE "upload_attempts"')
  })
})

describe("PR-5B.3 additive supporting upload intent schema", () => {
  it("keeps supporting metadata separate from the PHI-free UploadAttempt", async () => {
    const schema = await fs.readFile(schemaPath, "utf8")
    const attemptBlock = schema.slice(schema.indexOf("model UploadAttempt {"), schema.indexOf("model TemplateUploadIntent {"))
    const intentBlock = schema.slice(schema.indexOf("model SupportingUploadIntent {"), schema.indexOf("model AiExtraction {"))
    expect(attemptBlock).toContain("validatedMimeType")
    expect(attemptBlock).not.toContain("originalFileName")
    expect(intentBlock).toContain("uploadAttemptId")
    expect(intentBlock).toContain("supportingDocumentId")
    expect(intentBlock).toContain("portalRequestId")
    expect(intentBlock).toContain("clientId")
  })

  it("is additive and performs no backfill or owner/storage mutation", async () => {
    const migration = await fs.readFile(supportingMigrationPath, "utf8")
    expect(migration).toContain('CREATE TABLE "supporting_upload_intents"')
    expect(migration).toContain('ALTER TABLE "upload_attempts" ADD COLUMN "validated_mime_type" TEXT;')
    expect(migration).not.toMatch(/\bINSERT\b/i)
    expect(migration).not.toMatch(/^\s*UPDATE\s/im)
    expect(migration).not.toContain('ALTER TABLE "supporting_documents"')
    expect(migration).not.toContain('ALTER TABLE "stored_objects"')
    expect(migration).not.toContain('ALTER TABLE "document_templates"')
    expect(migration).not.toMatch(/ALTER TABLE "upload_attempts" (?!ADD COLUMN "validated_mime_type")/)
  })
})
