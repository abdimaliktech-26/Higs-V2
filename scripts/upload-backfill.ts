/**
 * PR-5C.2 legacy-row backfill: migrate unlinked template/supporting rows
 * onto verified durable S3 objects without touching the local legacy files.
 *
 * Usage: npm run upload:backfill -- [--dry-run] [--batch=25]
 *        (npx tsx --conditions=react-server scripts/upload-backfill.ts ...)
 *
 * Safety model:
 *  - Fails closed unless STORAGE_PROVIDER=s3.
 *  - Reads the existing local legacy file; never replaces or deletes it.
 *  - Streams through the bounded spool, verifies the exact written durable
 *    object version (checksum, size, MIME, SSE-KMS key), and only then
 *    creates the AVAILABLE StoredObject (malwareStatus NOT_SCANNED, honest)
 *    and links the owner in one guarded transaction.
 *  - Batch-bounded, idempotent, resumable: linked owners leave the
 *    candidate set; failed links leave only a report-only durable orphan.
 *  - Placeholder-only pdf_version rows are excluded entirely.
 */

import "dotenv/config"
import { readStorageConfiguration, createStorageAdapter } from "../src/lib/storage/index"
import { assertOperatorS3Storage } from "../src/lib/uploads/operations"
import { backfillLegacyOwnerObjects, DEFAULT_BACKFILL_BATCH_LIMIT } from "../src/lib/uploads/backfill"
import { prisma } from "../src/lib/db"

interface CliOptions {
  dryRun: boolean
  batchLimit: number
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = { dryRun: false, batchLimit: DEFAULT_BACKFILL_BATCH_LIMIT }
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true
    else if (argument.startsWith("--batch=")) {
      const value = Number.parseInt(argument.slice(8), 10)
      if (!Number.isInteger(value) || value < 1 || value > 200) throw new Error("--batch must be between 1 and 200")
      options.batchLimit = value
    } else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  assertOperatorS3Storage(readStorageConfiguration(), "legacy-row backfill")
  const summary = await backfillLegacyOwnerObjects(createStorageAdapter(), options)
  process.stdout.write(
    JSON.stringify({ startedAt: new Date().toISOString(), dryRun: options.dryRun, batchLimit: options.batchLimit, ...summary }, null, 2) + "\n",
  )
}

main()
  .catch((error) => {
    process.stderr.write(`upload-backfill failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
