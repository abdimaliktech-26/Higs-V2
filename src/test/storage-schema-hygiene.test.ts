import fs from "fs/promises"
import path from "path"
import { describe, expect, it } from "vitest"

const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma")
const migrationPath = path.join(process.cwd(), "prisma", "migrations", "20260714230000_add_stored_object_metadata", "migration.sql")

describe("StoredObject additive schema", () => {
  it("keeps legacy columns and adds only nullable ownership links", async () => {
    const schema = await fs.readFile(schemaPath, "utf8")
    expect(schema).toContain("model StoredObject")
    expect(schema).toContain("storedObjectId    String?  @unique")
    expect(schema).toContain("storedObjectId   String?  @unique")
    expect(schema).toContain("storedObjectId         String?")
    expect(schema).toContain("fileUrl")
    expect(schema).toContain("fileKey")
    expect(schema).toContain("fileSize")
    expect(schema).toContain("mimeType")
    const packetDocumentBlock = schema.slice(schema.indexOf("model PacketDocument {"), schema.indexOf("model PdfField {"))
    expect(packetDocumentBlock).not.toContain("storedObjectId")
  })

  it("creates no rows, backfill, or clean/finalized/retained state", async () => {
    const migration = await fs.readFile(migrationPath, "utf8")
    expect(migration).not.toMatch(/\bINSERT\b/i)
    expect(migration).not.toMatch(/^\s*UPDATE\s/im)
    expect(migration).not.toMatch(/DEFAULT 'AVAILABLE'/)
    expect(migration).not.toMatch(/DEFAULT 'CLEAN'/)
    expect(migration).toContain("DEFAULT 'PENDING'")
    expect(migration).toContain("DEFAULT 'NOT_SCANNED'")
    expect(migration).toContain('"immutable" BOOLEAN NOT NULL DEFAULT false')
    expect(migration).toContain('"legal_hold" BOOLEAN NOT NULL DEFAULT false')
  })

  it("limits the migration to approved tables, enums, indexes, and foreign keys", async () => {
    const migration = await fs.readFile(migrationPath, "utf8")
    expect(migration).toContain('CREATE TABLE "stored_objects"')
    expect(migration).toContain('ALTER TABLE "document_templates" ADD COLUMN "stored_object_id" TEXT')
    expect(migration).toContain('ALTER TABLE "pdf_versions" ADD COLUMN "stored_object_id" TEXT')
    expect(migration).toContain('ALTER TABLE "supporting_documents" ADD COLUMN "stored_object_id" TEXT')
    expect(migration).not.toContain('ALTER TABLE "packet_documents"')
  })
})

describe("storage fixtures and repository hygiene", () => {
  it("keeps exactly 14 generic synthetic PDF fixtures outside runtime storage", async () => {
    const fixtureRoot = path.join(process.cwd(), "prisma", "fixtures", "templates")
    const names = (await fs.readdir(fixtureRoot)).sort()
    expect(names).toHaveLength(14)
    expect(names.every((name) => name.endsWith(".pdf") && !name.includes("@"))).toBe(true)
    for (const name of names) {
      const bytes = await fs.readFile(path.join(fixtureRoot, name))
      expect(bytes.subarray(0, 4).toString("ascii")).toBe("%PDF")
      const printable = bytes.toString("latin1")
      expect(printable).not.toMatch(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)
      expect(printable).not.toMatch(/\b\d{3}-\d{2}-\d{4}\b/)
    }
  })

  it("makes the seed consume the explicit fixture directory", async () => {
    const seed = await fs.readFile(path.join(process.cwd(), "prisma", "seed.ts"), "utf8")
    expect(seed).toContain('"prisma", "fixtures", "templates"')
    expect(seed).not.toContain("generateMinimalPDF")
  })

  it("ignores runtime storage, quarantine, backups, and migration outputs", async () => {
    const ignore = await fs.readFile(path.join(process.cwd(), ".gitignore"), "utf8")
    expect(ignore).toContain("/private/data/")
    expect(ignore).toContain("/private/quarantine/")
    expect(ignore).toContain("/backups/")
    expect(ignore).toContain("/storage-migration-reports/")
    expect(ignore).toContain("/storage-migration-tmp/")
  })
})
