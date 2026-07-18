/**
 * Slice A — MN 245D content ingestion (development/synthetic environments).
 *
 * Usage: npm run ingest:245d -- [--source=~/Desktop/intakeforms/pdf] [--org=north-star-care] [--dry-run]
 *        (npx tsx --conditions=react-server scripts/ingest-245d.ts ...)
 *
 * Loads the operator-converted 245D PDFs (44 files across intake/45day/
 * semiannual/annual) as DocumentTemplate rows and builds the four workflow
 * packet templates, including the previously unused 45_day packet type.
 *
 * Boundaries:
 *  - Deep-validates every PDF with the strict template profile before storing.
 *  - Source files are read-only; nothing in the source tree is modified.
 *  - Idempotent: templates are matched by name and never duplicated; packet
 *    templates are matched by (packetType, name) and their document mappings
 *    reconciled additively. Safe to rerun.
 *  - Stores through the local compatibility path exactly like prisma/seed.ts.
 *    Staging/production ingestion instead re-uploads each PDF through the
 *    scanned upload pipeline once the S3/GuardDuty gate is live; this script
 *    refuses to run when STORAGE_PROVIDER is not local for that reason.
 *  - The DHS PDFs themselves are never committed to the repository.
 */

import "dotenv/config"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { prisma } from "../src/lib/db"
import { storeFile } from "../src/lib/storage"
import { readStorageConfiguration } from "../src/lib/storage/index"
import { TEMPLATE_PDF_PROFILE } from "../src/lib/uploads/profiles"
import { validateUpload } from "../src/lib/uploads/validation"
import { STAGE_DEFINITIONS, templateNameFromSourceFile } from "../src/lib/content/forms-245d"

interface CliOptions {
  sourceRoot: string
  orgSlug: string
  dryRun: boolean
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    sourceRoot: path.join(os.homedir(), "Desktop", "intakeforms", "pdf"),
    orgSlug: "north-star-care",
    dryRun: false,
  }
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true
    else if (argument.startsWith("--source=")) options.sourceRoot = argument.slice(9).replace(/^~\//, `${os.homedir()}/`)
    else if (argument.startsWith("--org=")) options.orgSlug = argument.slice(6)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const configuration = readStorageConfiguration()
  if (configuration.provider !== "local") {
    throw new Error(
      "Refusing to run: this development ingestion uses the local compatibility store. " +
        "In S3 environments, ingest each form through the scanned template upload pipeline instead.",
    )
  }

  const organization = await prisma.organization.findUnique({ where: { slug: options.orgSlug }, select: { id: true } })
  if (!organization) throw new Error(`Organization with slug "${options.orgSlug}" not found`)
  const uploader = await prisma.user.findFirst({
    where: { memberships: { some: { organizationId: organization.id, role: "ORG_ADMIN", status: "ACTIVE" } } },
    select: { id: true },
  })
  if (!uploader) throw new Error("No active ORG_ADMIN found to attribute uploads to")

  const report: Record<string, unknown>[] = []
  for (const stage of STAGE_DEFINITIONS) {
    const directory = path.join(options.sourceRoot, stage.directory)
    const files = (await fs.readdir(directory)).filter((file) => file.toLowerCase().endsWith(".pdf")).sort()
    if (files.length !== stage.expectedFormCount) {
      throw new Error(`${stage.directory}: expected ${stage.expectedFormCount} PDFs, found ${files.length}`)
    }

    const templateIds: string[] = []
    let created = 0
    let existing = 0
    for (const file of files) {
      const templateName = templateNameFromSourceFile(file, stage)
      const already = await prisma.documentTemplate.findFirst({
        where: { organizationId: organization.id, name: templateName, previousVersionId: null },
        select: { id: true },
      })
      if (already) {
        templateIds.push(already.id)
        existing++
        continue
      }
      const filePath = path.join(directory, file)
      const size = (await fs.stat(filePath)).size
      await validateUpload({
        source: { path: filePath, size, openStream: () => createReadStream(filePath) },
        extension: ".pdf",
        declaredMimeType: "application/pdf",
        policy: TEMPLATE_PDF_PROFILE,
      })
      if (options.dryRun) {
        created++
        continue
      }
      const buffer = await fs.readFile(filePath)
      const record = await storeFile(
        `templates/245d/${stage.directory}/${file.replace(/[^a-zA-Z0-9. _-]/g, "_")}`,
        buffer,
        "application/pdf",
        file,
      )
      const template = await prisma.documentTemplate.create({
        data: {
          organizationId: organization.id,
          name: templateName,
          formType: "dhs",
          program: null,
          status: "active",
          version: 1,
          fileUrl: record.url,
          fileKey: record.key,
          fileSize: record.size,
          mimeType: "application/pdf",
          uploadedById: uploader.id,
        },
      })
      templateIds.push(template.id)
      created++
    }

    let packetTemplateId: string | null = null
    if (!options.dryRun) {
      const packetTemplate =
        (await prisma.packetTemplate.findFirst({
          where: { organizationId: organization.id, packetType: stage.packetType, name: stage.packetTemplateName },
        })) ??
        (await prisma.packetTemplate.create({
          data: {
            organizationId: organization.id,
            name: stage.packetTemplateName,
            description: `Official MN 245D ${stage.namePrefix} workflow packet`,
            packetType: stage.packetType,
            status: "active",
            isDefault: false,
          },
        }))
      packetTemplateId = packetTemplate.id
      for (const [index, documentTemplateId] of templateIds.entries()) {
        await prisma.packetTemplateDocument.upsert({
          where: { packetTemplateId_documentTemplateId: { packetTemplateId: packetTemplate.id, documentTemplateId } },
          create: { packetTemplateId: packetTemplate.id, documentTemplateId, required: true, sortOrder: index },
          update: { sortOrder: index },
        })
      }
    }
    report.push({
      stage: stage.directory,
      packetType: stage.packetType,
      packetTemplateId,
      templates: files.length,
      created,
      existing,
    })
  }

  process.stdout.write(JSON.stringify({ dryRun: options.dryRun, orgSlug: options.orgSlug, stages: report }, null, 2) + "\n")
}

main()
  .catch((error) => {
    process.stderr.write(`ingest-245d failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
