/**
 * Synthetic upload-platform verification for the approved 25 MB path.
 *
 * Usage: npm run upload:verify-platform -- [--size-mb=25] [--concurrency=3]
 *                                          [--http=<url> --cookie=<cookie-header>]
 *        (npx tsx --conditions=react-server scripts/upload-platform-verify.ts ...)
 *
 * Storage mode (default): streams synthetic PDFs through the bounded spool
 * into the quarantine bucket, copies each exact version to the durable
 * bucket, streams it back, re-verifies SHA-256, and deletes both exact
 * versions. HTTP mode additionally POSTs one synthetic 25 MB multipart body
 * to the given initiate route and requires a 202 receipt.
 *
 * Fail-closed rules:
 *  - Refuses to run at all unless STORAGE_PROVIDER=s3 with a complete S3
 *    configuration; local storage can never produce platform evidence.
 *  - This tool NEVER sets UPLOAD_PLATFORM_LIMITS_VERIFIED. It prints the
 *    evidence for the operator, who sets the flag only for the runtime that
 *    actually passed.
 */

import "dotenv/config"
import { createHash, randomUUID } from "node:crypto"
import { Readable } from "node:stream"
import { createStorageAdapter, readStorageConfiguration, storageKeys } from "../src/lib/storage/index"
import { assertOperatorS3Storage } from "../src/lib/uploads/operations"
import { withUploadSpool } from "../src/lib/uploads/stream"

interface CliOptions {
  sizeMb: number
  concurrency: number
  httpUrl?: string
  cookie?: string
}

function parseArguments(argv: string[]): CliOptions {
  const options: CliOptions = { sizeMb: 25, concurrency: 3 }
  for (const argument of argv) {
    if (argument.startsWith("--size-mb=")) options.sizeMb = bounded(argument.slice(10), 1, 25)
    else if (argument.startsWith("--concurrency=")) options.concurrency = bounded(argument.slice(14), 1, 10)
    else if (argument.startsWith("--http=")) options.httpUrl = argument.slice(7)
    else if (argument.startsWith("--cookie=")) options.cookie = argument.slice(9)
    else throw new Error(`Unknown argument: ${argument}`)
  }
  return options
}

function bounded(raw: string, minimum: number, maximum: number): number {
  const value = Number.parseInt(raw, 10)
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Value ${raw} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

/** Builds a structurally valid single-page PDF padded to the target size. */
export function buildSyntheticPdf(targetBytes: number): Buffer {
  const header = Buffer.from("%PDF-1.4\n")
  const object1 = Buffer.from("1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n")
  const object2 = Buffer.from("2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n")
  const object3 = Buffer.from("3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\n")
  const fixedOverhead = 420
  const paddingLength = Math.max(1, targetBytes - header.length - object1.length - object2.length - object3.length - fixedOverhead)
  const streamHead = Buffer.from(`4 0 obj<</Length ${paddingLength}>>stream\n`)
  const padding = Buffer.alloc(paddingLength, 0x20)
  const streamTail = Buffer.from("\nendstream\nendobj\n")

  const offsets: number[] = []
  let cursor = header.length
  for (const part of [object1, object2, object3]) {
    offsets.push(cursor)
    cursor += part.length
  }
  offsets.push(cursor)
  cursor += streamHead.length + padding.length + streamTail.length
  const xrefOffset = cursor
  const xref = Buffer.from(
    "xref\n0 5\n0000000000 65535 f \n" +
      offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("") +
      `trailer<</Size 5/Root 1 0 R>>\nstartxref\n${xrefOffset}\n%%EOF\n`,
  )
  return Buffer.concat([header, object1, object2, object3, streamHead, padding, streamTail, xref])
}

async function verifyStorageRoundTrip(sizeMb: number, runIndex: number): Promise<Record<string, unknown>> {
  const adapter = createStorageAdapter()
  const payload = buildSyntheticPdf(sizeMb * 1024 * 1024)
  const expectedChecksum = createHash("sha256").update(payload).digest("hex")
  const organizationId = randomUUID()
  const uploadAttemptId = randomUUID()
  const artifactId = randomUUID()
  const quarantineKey = storageKeys.quarantine({ organizationId, uploadAttemptId, artifactId })
  const durableKey = storageKeys.organizationSupportingDocument({
    organizationId,
    supportingDocumentId: randomUUID(),
    artifactId,
  })

  const startedAt = Date.now()
  const result = await withUploadSpool(
    { stream: Readable.from(payload), maxBytes: 25 * 1024 * 1024, declaredSize: payload.length },
    async (spool) => {
      if (spool.checksumSha256 !== expectedChecksum) throw new Error("Spool checksum mismatch")
      const quarantined = await adapter.putObject({
        key: quarantineKey,
        location: "quarantine",
        body: spool.openStream(),
        expectedContentLength: spool.size,
        mimeType: "application/pdf",
        checksumSha256: spool.checksumSha256,
        encryption: { mode: "sse-kms" },
        preconditions: { ifNoneMatch: true },
        metadata: { platformVerification: "true" },
      })
      if (!quarantined.versionId) throw new Error("Quarantine store returned no version")
      const promoted = await adapter.copyObject({
        source: { key: quarantineKey, location: "quarantine", versionId: quarantined.versionId },
        destination: { key: durableKey, location: "durable" },
        mimeType: "application/pdf",
        checksumSha256: spool.checksumSha256,
        encryption: { mode: "sse-kms" },
        preconditions: { ifNoneMatch: true },
        metadata: { platformVerification: "true" },
      })
      if (!promoted.versionId || promoted.checksumSha256 !== expectedChecksum || promoted.size !== payload.length) {
        throw new Error("Durable copy verification failed")
      }
      const readBack = await adapter.getObjectStream({ key: durableKey, location: "durable", versionId: promoted.versionId })
      const readHash = createHash("sha256")
      for await (const chunk of readBack.stream) readHash.update(chunk as Buffer)
      if (readHash.digest("hex") !== expectedChecksum) throw new Error("Read-back checksum mismatch")
      await adapter.deleteObject({ key: durableKey, location: "durable", versionId: promoted.versionId })
      await adapter.deleteObject({ key: quarantineKey, location: "quarantine", versionId: quarantined.versionId })
      return { quarantineVersion: quarantined.versionId, durableVersion: promoted.versionId }
    },
  )
  return {
    run: runIndex,
    sizeBytes: payload.length,
    checksumVerified: true,
    exactVersionsDeleted: true,
    durationMs: Date.now() - startedAt,
    ...result,
  }
}

async function verifyHttpReceipt(url: string, cookie: string | undefined, sizeMb: number): Promise<Record<string, unknown>> {
  const payload = buildSyntheticPdf(sizeMb * 1024 * 1024)
  const boundary = `----higsiPlatformVerify${randomUUID().replace(/-/g, "")}`
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="title"\r\n\r\nPlatform verification\r\n` +
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="platform-verify.pdf"\r\nContent-Type: application/pdf\r\n\r\n`,
  )
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`)
  const startedAt = Date.now()
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "idempotency-key": randomUUID(),
      ...(cookie ? { cookie } : {}),
    },
    body: new Uint8Array(Buffer.concat([head, payload, tail])),
  })
  const body = await response.json().catch(() => null)
  const accepted = response.status === 202 && body?.success === true && body?.data?.status === "SCANNING"
  return {
    url,
    sizeBytes: payload.length,
    httpStatus: response.status,
    receiptAccepted: accepted,
    attemptId: accepted ? body.data.attemptId : undefined,
    durationMs: Date.now() - startedAt,
  }
}

async function main(): Promise<void> {
  const options = parseArguments(process.argv.slice(2))
  const configuration = readStorageConfiguration()
  assertOperatorS3Storage(configuration, "upload-platform verification")

  const storageRuns = await Promise.all(
    Array.from({ length: options.concurrency }, (_, index) => verifyStorageRoundTrip(options.sizeMb, index + 1)),
  )
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    target: { provider: "s3", region: configuration.region },
    sizeMb: options.sizeMb,
    concurrency: options.concurrency,
    storageRuns,
    storagePathVerified: storageRuns.every((run) => run.checksumVerified === true),
  }
  if (options.httpUrl) {
    report.httpReceipt = await verifyHttpReceipt(options.httpUrl, options.cookie, options.sizeMb)
  }
  report.note =
    "This tool records evidence only. Set UPLOAD_PLATFORM_LIMITS_VERIFIED=true manually, and only for the runtime that produced this evidence."
  process.stdout.write(JSON.stringify(report, null, 2) + "\n")
  if (report.storagePathVerified !== true) process.exitCode = 1
}

const isDirectRun = process.argv[1]?.endsWith("upload-platform-verify.ts")
if (isDirectRun) {
  main().catch((error) => {
    process.stderr.write(`upload-platform-verify failed: ${error instanceof Error ? error.message : "unknown error"}\n`)
    process.exitCode = 1
  })
}
