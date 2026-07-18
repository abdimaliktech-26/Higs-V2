/**
 * Read-only upload reconciliation report.
 *
 * Usage: npm run upload:reconcile
 *        (npx tsx --conditions=react-server scripts/upload-reconcile.ts)
 *
 * Prints an opaque findings report. When STORAGE_PROVIDER=s3 it also runs
 * read-only storage existence probes; otherwise probes are skipped and the
 * report is database-only. This script never writes or deletes anything.
 */

import "dotenv/config"
import { readStorageConfiguration, createStorageAdapter } from "../src/lib/storage/index"
import { buildStorageBackedProbes } from "../src/lib/uploads/operations"
import { generateUploadReconciliationReport } from "../src/lib/uploads/reconciliation"
import { prisma } from "../src/lib/db"

async function main(): Promise<void> {
  const configuration = readStorageConfiguration()
  const useProbes = configuration.provider === "s3"
  const probeBundle = useProbes ? buildStorageBackedProbes(createStorageAdapter(), configuration) : null

  const findings = await generateUploadReconciliationReport(prisma, {
    probes: probeBundle?.probes,
  })
  const countsByCategory: Record<string, number> = {}
  for (const finding of findings) {
    countsByCategory[finding.category] = (countsByCategory[finding.category] ?? 0) + 1
  }
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        storageProvider: configuration.provider,
        probesRan: useProbes,
        probeFailures: probeBundle?.failures ?? [],
        total: findings.length,
        countsByCategory,
        findings,
      },
      null,
      2,
    ) + "\n",
  )
}

main()
  .catch((error) => {
    process.stderr.write(`upload-reconcile failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  })
  .finally(() => prisma.$disconnect())
