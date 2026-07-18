/**
 * Bounded upload recovery and quarantine cleanup.
 *
 * Usage: npm run upload:cleanup -- [--dry-run] [--batch=50] [--stale-minutes=60]
 *                                  [--recover-only|--cleanup-only]
 *        (npx tsx --conditions=react-server scripts/upload-cleanup.ts ...)
 *
 * Safety model:
 *  - Fails closed unless STORAGE_PROVIDER=s3 — cleanup never runs against
 *    local development storage.
 *  - Recovery fails stuck attempts only through guarded lifecycle
 *    transitions; a live completion always wins the race.
 *  - Cleanup deletes only the exact quarantine object version recorded on an
 *    eligible attempt, honors the recorded retention expiry (7-day suspect
 *    hold included), and never touches a durable object.
 *  - Every run is bounded by the batch limit and safe to rerun.
 */

import "dotenv/config"
import { readStorageConfiguration, createStorageAdapter } from "../src/lib/storage/index"
import {
  DEFAULT_OPERATION_BATCH_LIMIT,
  DEFAULT_STALE_ATTEMPT_MS,
  assertOperatorS3Storage,
  executeQuarantineCleanup,
  recoverStuckUploadAttempts,
} from "../src/lib/uploads/operations"
import { prisma } from "../src/lib/db"

interface CliOptions {
  dryRun: boolean
  batchLimit: number
  staleAttemptMs: number
  recoverOnly: boolean
  cleanupOnly: boolean
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = {
    dryRun: false,
    batchLimit: DEFAULT_OPERATION_BATCH_LIMIT,
    staleAttemptMs: DEFAULT_STALE_ATTEMPT_MS,
    recoverOnly: false,
    cleanupOnly: false,
  }
  for (const argument of argv) {
    if (argument === "--dry-run") options.dryRun = true
    else if (argument === "--recover-only") options.recoverOnly = true
    else if (argument === "--cleanup-only") options.cleanupOnly = true
    else if (argument.startsWith("--batch=")) options.batchLimit = ensureBoundedInteger(argument.slice(8), 1, 500)
    else if (argument.startsWith("--stale-minutes=")) options.staleAttemptMs = ensureBoundedInteger(argument.slice(16), 5, 24 * 60) * 60 * 1000
    else throw new Error(`Unknown argument: ${argument}`)
  }
  if (options.recoverOnly && options.cleanupOnly) throw new Error("Choose at most one of --recover-only / --cleanup-only")
  return options
}

function ensureBoundedInteger(raw: string, minimum: number, maximum: number): number {
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Value ${raw} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const configuration = readStorageConfiguration()
  assertOperatorS3Storage(configuration, "upload cleanup")
  const adapter = createStorageAdapter()

  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    dryRun: options.dryRun,
    batchLimit: options.batchLimit,
  }
  if (!options.cleanupOnly) {
    report.recovery = await recoverStuckUploadAttempts({
      staleAttemptMs: options.staleAttemptMs,
      batchLimit: options.batchLimit,
      dryRun: options.dryRun,
    })
  }
  if (!options.recoverOnly) {
    report.cleanup = await executeQuarantineCleanup(adapter, {
      batchLimit: options.batchLimit,
      dryRun: options.dryRun,
    })
  }
  report.finishedAt = new Date().toISOString()
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
}

main()
  .catch((error) => {
    process.stderr.write(`upload-cleanup failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
