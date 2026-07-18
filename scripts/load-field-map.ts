/**
 * Slice B — field-map loader (development/synthetic environments).
 *
 * Usage: npm run load:field-map -- --map=content/245d/field-maps/intake-dpf-004.json [--org=north-star-care] [--dry-run]
 *
 * Applies a repository-versioned field map to its DocumentTemplate. Maps are
 * authored in PDF points (top-down); the loader converts to the editor's
 * base-scale-1.5 canvas units (px = pt * 1.5) so authored geometry and
 * drag-editor geometry share one convention. Idempotent: fields are upserted
 * by (template, fieldKey) and sort order mirrors map order. The template's
 * PDF is never touched — geometry lives only in the database.
 */

import "dotenv/config"
import fs from "node:fs/promises"
import path from "node:path"
import { prisma } from "../src/lib/db"
import { TEMPLATE_FIELD_TYPES } from "../src/lib/validation"

const BASE_SCALE = 1.5

interface FieldMapField {
  fieldKey: string
  name: string
  fieldType: string
  pageNumber: number
  posX: number
  posY: number
  width: number
  height: number
  isRequired: boolean
  /** Authors a FIELD_REQUIREDNESS condition: required when the referenced sibling field matches. */
  requiredWhen?: { fieldKey: string; operator: "CHECKED" | "UNCHECKED" | "NOT_EMPTY" | "EQUALS"; comparisonValue?: string }
}

interface FieldMap {
  templateName: string
  coordinateUnits: string
  fields: FieldMapField[]
}

function parseArguments(argv: string[]): { mapPath: string; orgSlug: string; dryRun: boolean } {
  const options = { mapPath: "", orgSlug: "north-star-care", dryRun: false }
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true
    else if (argument.startsWith("--map=")) options.mapPath = argument.slice(6)
    else if (argument.startsWith("--org=")) options.orgSlug = argument.slice(6)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (!options.mapPath) throw new Error("--map=<path> is required")
  return options
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const map = JSON.parse(await fs.readFile(path.resolve(options.mapPath), "utf8")) as FieldMap
  if (map.coordinateUnits !== "pdf-points-top-down") throw new Error("Unsupported coordinate units in field map")
  const seenKeys = new Set<string>()
  for (const field of map.fields) {
    if (seenKeys.has(field.fieldKey)) throw new Error(`Duplicate fieldKey in map: ${field.fieldKey}`)
    seenKeys.add(field.fieldKey)
    if (!(TEMPLATE_FIELD_TYPES as readonly string[]).includes(field.fieldType)) {
      throw new Error(`Unknown fieldType "${field.fieldType}" for ${field.fieldKey}`)
    }
  }
  for (const field of map.fields) {
    if (field.requiredWhen && !seenKeys.has(field.requiredWhen.fieldKey)) {
      throw new Error(`requiredWhen for ${field.fieldKey} references unknown fieldKey ${field.requiredWhen.fieldKey}`)
    }
  }

  const organization = await prisma.organization.findUnique({ where: { slug: options.orgSlug }, select: { id: true } })
  if (!organization) throw new Error(`Organization with slug "${options.orgSlug}" not found`)
  const template = await prisma.documentTemplate.findFirst({
    where: { organizationId: organization.id, name: map.templateName, previousVersionId: null },
    select: { id: true },
  })
  if (!template) throw new Error(`DocumentTemplate "${map.templateName}" not found — run ingest:245d first`)

  let created = 0
  let updated = 0
  let conditions = 0
  for (const [index, field] of map.fields.entries()) {
    const data = {
      name: field.name,
      fieldType: field.fieldType,
      pageNumber: field.pageNumber,
      posX: field.posX * BASE_SCALE,
      posY: field.posY * BASE_SCALE,
      width: field.width * BASE_SCALE,
      height: field.height * BASE_SCALE,
      isRequired: field.isRequired,
      sortOrder: index,
    }
    if (options.dryRun) continue
    const result = await prisma.documentTemplateField.upsert({
      where: { documentTemplateId_fieldKey: { documentTemplateId: template.id, fieldKey: field.fieldKey } },
      create: { organizationId: organization.id, documentTemplateId: template.id, fieldKey: field.fieldKey, ...data },
      update: data,
    })
    if (result.createdAt.getTime() === result.updatedAt.getTime()) created++
    else updated++

    // Conditions are reconciled deterministically: the map is the source of
    // truth, so any existing field-owned groups are replaced on every run.
    await prisma.templateConditionGroup.deleteMany({ where: { documentTemplateFieldId: result.id } })
    if (field.requiredWhen) {
      await prisma.templateConditionGroup.create({
        data: {
          organizationId: organization.id,
          purpose: "FIELD_REQUIREDNESS",
          logicOperator: "AND",
          documentTemplateFieldId: result.id,
          conditions: {
            create: [{
              sourceType: "TEMPLATE_FIELD",
              sourceFieldKey: field.requiredWhen.fieldKey,
              operator: field.requiredWhen.operator,
              comparisonValue: field.requiredWhen.comparisonValue ?? undefined,
              sortOrder: 0,
            }],
          },
        },
      })
      conditions++
    }
  }
  process.stdout.write(
    JSON.stringify({ template: map.templateName, mapFields: map.fields.length, created, updated, conditions, dryRun: options.dryRun }, null, 2) + "\n",
  )
}

main()
  .catch((error) => {
    process.stderr.write(`load-field-map failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
