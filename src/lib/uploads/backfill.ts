import "server-only"

import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { Prisma, StoredObjectLifecycleStatus, StoredObjectMalwareStatus } from "@prisma/client"
import { prisma } from "../db"
import { STORAGE_ROOT } from "../storage"
import { readStorageConfiguration, storageKeys, type StorageAdapter } from "../storage/index"
import { withUploadSpool } from "./stream"
import { sniffUploadFile } from "./validation"
import { MAX_UPLOAD_BYTES } from "./types"

export type BackfillOwnerKind = "DOCUMENT_TEMPLATE" | "SUPPORTING_DOCUMENT"

export type BackfillAction = "MIGRATED" | "SKIPPED" | "CONFLICT" | "MISSING" | "FAILED"

export interface BackfillOutcome {
  ownerKind: BackfillOwnerKind
  ownerId: string
  organizationId: string
  action: BackfillAction
  /** Bounded machine-readable reason; never a key, filename, or provider error. */
  detail: string
}

export interface BackfillSummary {
  attempted: number
  migrated: number
  skipped: number
  conflicted: number
  missing: number
  failed: number
  outcomes: BackfillOutcome[]
}

export interface BackfillOptions {
  batchLimit?: number
  dryRun?: boolean
}

export const DEFAULT_BACKFILL_BATCH_LIMIT = 25

interface BackfillCandidate {
  ownerKind: BackfillOwnerKind
  ownerId: string
  organizationId: string
  clientId: string | null
  fileKey: string
}

function summarize(outcomes: BackfillOutcome[]): BackfillSummary {
  return {
    attempted: outcomes.length,
    migrated: outcomes.filter((outcome) => outcome.action === "MIGRATED").length,
    skipped: outcomes.filter((outcome) => outcome.action === "SKIPPED").length,
    conflicted: outcomes.filter((outcome) => outcome.action === "CONFLICT").length,
    missing: outcomes.filter((outcome) => outcome.action === "MISSING").length,
    failed: outcomes.filter((outcome) => outcome.action === "FAILED").length,
    outcomes,
  }
}

function resolveLegacyPath(fileKey: string): string | null {
  const resolved = path.resolve(STORAGE_ROOT, fileKey)
  const relative = path.relative(STORAGE_ROOT, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null
  return resolved
}

/**
 * PR-5C.2 legacy-row backfill.
 *
 * Streams each unlinked owner's existing local legacy file into the durable
 * bucket, verifies the exact written object version (checksum, size, MIME,
 * SSE-KMS key), and only then — in a single transaction — creates the
 * AVAILABLE StoredObject (honest malwareStatus NOT_SCANNED; these bytes were
 * already served unscanned from local disk) and links the owner with a
 * guarded update. The local file is never modified or deleted, so rollback
 * remains a deployment decision. Placeholder-only pdf_version rows are
 * excluded entirely. Rerunning is safe: linked owners leave the candidate
 * set, and a failed link leaves only an unowned durable object, which stays
 * report-only per PR-5B.4.
 */
export async function backfillLegacyOwnerObjects(
  adapter: StorageAdapter,
  options: BackfillOptions = {},
): Promise<BackfillSummary> {
  const batchLimit = options.batchLimit ?? DEFAULT_BACKFILL_BATCH_LIMIT
  const configuration = readStorageConfiguration()

  const templates = await prisma.documentTemplate.findMany({
    where: { storedObjectId: null, fileKey: { not: "" } },
    orderBy: { createdAt: "asc" },
    take: batchLimit,
    select: { id: true, organizationId: true, fileKey: true },
  })
  const remaining = batchLimit - templates.length
  const supporting = remaining > 0
    ? await prisma.supportingDocument.findMany({
        where: { storedObjectId: null, fileKey: { not: "" } },
        orderBy: { createdAt: "asc" },
        take: remaining,
        select: { id: true, organizationId: true, clientId: true, fileKey: true },
      })
    : []

  const candidates: BackfillCandidate[] = [
    ...templates.map((owner) => ({
      ownerKind: "DOCUMENT_TEMPLATE" as const,
      ownerId: owner.id,
      organizationId: owner.organizationId,
      clientId: null,
      fileKey: owner.fileKey,
    })),
    ...supporting.map((owner) => ({
      ownerKind: "SUPPORTING_DOCUMENT" as const,
      ownerId: owner.id,
      organizationId: owner.organizationId,
      clientId: owner.clientId,
      fileKey: owner.fileKey,
    })),
  ]

  const outcomes: BackfillOutcome[] = []
  for (const candidate of candidates) {
    outcomes.push(await backfillOne(adapter, configuration.kmsKeyArn, candidate, options.dryRun === true))
  }
  return summarize(outcomes)
}

async function backfillOne(
  adapter: StorageAdapter,
  kmsKeyArn: string | undefined,
  candidate: BackfillCandidate,
  dryRun: boolean,
): Promise<BackfillOutcome> {
  const base = { ownerKind: candidate.ownerKind, ownerId: candidate.ownerId, organizationId: candidate.organizationId }

  const legacyPath = resolveLegacyPath(candidate.fileKey)
  if (!legacyPath) return { ...base, action: "SKIPPED", detail: "UNSAFE_LEGACY_KEY" }
  const stat = await fs.stat(legacyPath).catch(() => null)
  if (!stat || !stat.isFile()) return { ...base, action: "MISSING", detail: "LEGACY_FILE_MISSING" }
  if (stat.size < 1 || stat.size > MAX_UPLOAD_BYTES) return { ...base, action: "SKIPPED", detail: "SIZE_OUT_OF_BOUNDS" }

  const sniffed = await sniffUploadFile(legacyPath)
  if (!sniffed) return { ...base, action: "SKIPPED", detail: "UNSUPPORTED_FORMAT" }
  if (candidate.ownerKind === "DOCUMENT_TEMPLATE" && sniffed.format !== "pdf") {
    return { ...base, action: "SKIPPED", detail: "TEMPLATE_NOT_PDF" }
  }

  if (dryRun) return { ...base, action: "SKIPPED", detail: "DRY_RUN" }

  const artifactId = randomUUID()
  const durableKey =
    candidate.ownerKind === "DOCUMENT_TEMPLATE"
      ? storageKeys.templateSource({
          organizationId: candidate.organizationId,
          documentTemplateId: candidate.ownerId,
          artifactId,
        })
      : candidate.clientId
        ? storageKeys.clientSupportingDocument({
            organizationId: candidate.organizationId,
            clientId: candidate.clientId,
            supportingDocumentId: candidate.ownerId,
            artifactId,
          })
        : storageKeys.organizationSupportingDocument({
            organizationId: candidate.organizationId,
            supportingDocumentId: candidate.ownerId,
            artifactId,
          })

  let written
  let sourceChecksum: string
  try {
    const spooled = await withUploadSpool(
      { stream: createReadStream(legacyPath), maxBytes: MAX_UPLOAD_BYTES, declaredSize: stat.size },
      async (spool) => ({
        checksum: spool.checksumSha256,
        stored: await adapter.putObject({
          key: durableKey,
          location: "durable",
          body: spool.openStream(),
          expectedContentLength: spool.size,
          mimeType: sniffed.mimeType,
          checksumSha256: spool.checksumSha256,
          encryption: { mode: "sse-kms" },
          preconditions: { ifNoneMatch: true },
          metadata: { backfill: "true" },
        }),
      }),
    )
    written = spooled.stored
    sourceChecksum = spooled.checksum
  } catch {
    return { ...base, action: "FAILED", detail: "DURABLE_WRITE_FAILED" }
  }
  if (
    written.provider !== "s3" ||
    !written.versionId ||
    written.checksumSha256 !== sourceChecksum ||
    written.size !== stat.size ||
    written.mimeType !== sniffed.mimeType ||
    written.encryptionKeyReference !== kmsKeyArn
  ) {
    // The unlinked durable object remains report-only per PR-5B.4.
    return { ...base, action: "FAILED", detail: "DURABLE_VERIFICATION_FAILED" }
  }

  try {
    await prisma.$transaction(async (tx) => {
      const storedObject = await tx.storedObject.create({
        data: {
          organizationId: candidate.organizationId,
          provider: "S3",
          bucket: written.bucket,
          objectKey: written.key,
          objectVersionId: written.versionId,
          etag: written.etag ?? null,
          checksumSha256: written.checksumSha256,
          sizeBytes: BigInt(written.size),
          mimeType: written.mimeType,
          originalFileName: null,
          encryptionKeyRef: written.encryptionKeyReference ?? null,
          lifecycleStatus: StoredObjectLifecycleStatus.AVAILABLE,
          malwareStatus: StoredObjectMalwareStatus.NOT_SCANNED,
          immutable: false,
          legalHold: false,
        },
      })
      const linked =
        candidate.ownerKind === "DOCUMENT_TEMPLATE"
          ? await tx.documentTemplate.updateMany({
              where: { id: candidate.ownerId, storedObjectId: null },
              data: { storedObjectId: storedObject.id },
            })
          : await tx.supportingDocument.updateMany({
              where: { id: candidate.ownerId, storedObjectId: null },
              data: { storedObjectId: storedObject.id },
            })
      if (linked.count !== 1) throw new BackfillLinkConflict()
    })
  } catch (error) {
    if (error instanceof BackfillLinkConflict || (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")) {
      return { ...base, action: "CONFLICT", detail: "OWNER_LINK_CHANGED_CONCURRENTLY" }
    }
    return { ...base, action: "FAILED", detail: "DATABASE_FAILURE" }
  }
  return { ...base, action: "MIGRATED", detail: "EXACT_VERSION_LINKED" }
}

class BackfillLinkConflict extends Error {
  constructor() {
    super("Owner link changed concurrently")
    this.name = "BackfillLinkConflict"
  }
}
