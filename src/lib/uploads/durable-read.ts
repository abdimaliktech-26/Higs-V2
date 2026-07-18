import "server-only"

import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { Readable } from "node:stream"
import { StoredObjectLifecycleStatus, StoredObjectMalwareStatus } from "@prisma/client"
import { prisma } from "../db"
import { createStorageAdapter, readStorageConfiguration } from "../storage/index"
import { STORAGE_ROOT } from "../storage"

/** Bounded operational failure: the object should exist but cannot be served right now. */
export class DurableReadUnavailableError extends Error {
  constructor() {
    super("Secure file delivery is temporarily unavailable.")
    this.name = "DurableReadUnavailableError"
  }
}

export interface FileReadSource {
  stream: Readable
  mimeType: string
  size: number
  source: "durable" | "legacy"
}

export interface AuthoritativeFileInput {
  organizationId: string
  storedObjectId: string | null | undefined
  legacyFileKey: string | null | undefined
}

/**
 * PR-5C.1 dual-source resolution.
 *
 * A row with a storedObjectId serves only from the exact recorded durable
 * S3 object version — AVAILABLE lifecycle, malware status CLEAN or
 * NOT_SCANNED (backfilled legacy bytes were already served unscanned from
 * local disk; PENDING/INFECTED/ERROR never serve), matching organization,
 * and the currently configured durable bucket. It never falls back to the
 * local compatibility copy: disqualifying metadata returns null (bounded
 * non-serve) and provider trouble throws DurableReadUnavailableError (503).
 *
 * A row without a storedObjectId keeps the exact legacy local read.
 * The quarantine bucket is never a read source.
 */
export async function openAuthoritativeFileSource(input: AuthoritativeFileInput): Promise<FileReadSource | null> {
  if (input.storedObjectId) return openDurableSource(input.storedObjectId, input.organizationId)
  if (input.legacyFileKey) return openLegacySource(input.legacyFileKey)
  return null
}

const SERVABLE_MALWARE_STATUSES: readonly StoredObjectMalwareStatus[] = [
  StoredObjectMalwareStatus.CLEAN,
  StoredObjectMalwareStatus.NOT_SCANNED,
]

async function openDurableSource(storedObjectId: string, organizationId: string): Promise<FileReadSource | null> {
  const object = await prisma.storedObject.findUnique({ where: { id: storedObjectId } })
  if (
    !object ||
    object.organizationId !== organizationId ||
    object.provider !== "S3" ||
    object.lifecycleStatus !== StoredObjectLifecycleStatus.AVAILABLE ||
    !SERVABLE_MALWARE_STATUSES.includes(object.malwareStatus) ||
    !object.objectVersionId
  ) {
    return null
  }
  const configuration = readStorageConfiguration()
  if (configuration.provider !== "s3" || object.bucket !== configuration.durableBucket) {
    // The object exists but this deployment cannot reach it — an
    // operational condition, not a not-found.
    throw new DurableReadUnavailableError()
  }
  try {
    const result = await createStorageAdapter().getObjectStream({
      key: object.objectKey,
      location: "durable",
      versionId: object.objectVersionId,
    })
    return {
      stream: result.stream,
      // Verified metadata from the StoredObject row, never re-derived.
      mimeType: object.mimeType,
      size: Number(object.sizeBytes),
      source: "durable",
    }
  } catch {
    throw new DurableReadUnavailableError()
  }
}

const LEGACY_MIME_BY_EXTENSION: Record<string, string> = {
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
}

async function openLegacySource(fileKey: string): Promise<FileReadSource | null> {
  const resolved = path.resolve(STORAGE_ROOT, fileKey)
  const relative = path.relative(STORAGE_ROOT, resolved)
  if (relative.startsWith("..") || path.isAbsolute(relative)) return null
  try {
    const stat = await fs.stat(resolved)
    if (!stat.isFile()) return null
    return {
      stream: createReadStream(resolved),
      mimeType: LEGACY_MIME_BY_EXTENSION[path.extname(fileKey).toLowerCase()] ?? "application/octet-stream",
      size: stat.size,
      source: "legacy",
    }
  } catch {
    return null
  }
}
