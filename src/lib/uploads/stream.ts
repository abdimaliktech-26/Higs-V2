import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { chmod, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Transform, type Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import { UploadFailureCategory } from "@prisma/client"
import { UploadValidationError } from "./errors"
import type { UploadValidationSource } from "./types"

export interface UploadSpool extends UploadValidationSource {
  checksumSha256: string
}

export interface SpoolUploadInput {
  stream: Readable
  maxBytes: number
  declaredSize?: number
  temporaryRoot?: string
}

/**
 * Receives an upload once, enforcing actual bytes and calculating SHA-256 in
 * the same stream pass. The permission-restricted spool exists only for the
 * callback and is removed after success or failure. This supplies the
 * precomputed checksum/length required by the S3 adapter without buffering the
 * request body in memory.
 */
export async function withUploadSpool<T>(input: SpoolUploadInput, callback: (spool: UploadSpool) => Promise<T>): Promise<T> {
  if (input.declaredSize !== undefined && input.declaredSize > input.maxBytes) {
    throw new UploadValidationError(
      "SIZE_LIMIT",
      "The upload exceeds the configured size limit.",
      UploadFailureCategory.SIZE_LIMIT,
    )
  }

  const directory = await mkdtemp(join(input.temporaryRoot ?? tmpdir(), "higsi-upload-"))
  const spoolPath = join(directory, "payload")
  const hash = createHash("sha256")
  let actualSize = 0

  const meter = new Transform({
    transform(chunk: Buffer, _encoding, done) {
      actualSize += chunk.length
      if (actualSize > input.maxBytes) {
        done(
          new UploadValidationError(
            "SIZE_LIMIT",
            "The upload exceeds the configured size limit.",
            UploadFailureCategory.SIZE_LIMIT,
          ),
        )
        return
      }
      hash.update(chunk)
      done(null, chunk)
    },
  })

  try {
    await chmod(directory, 0o700)
    await pipeline(input.stream, meter, createWriteStream(spoolPath, { flags: "wx", mode: 0o600 }))

    if (input.declaredSize !== undefined && actualSize !== input.declaredSize) {
      throw new UploadValidationError(
        "SIZE_MISMATCH",
        "The received upload size does not match the declared size.",
        UploadFailureCategory.SIZE_MISMATCH,
      )
    }

    const spool: UploadSpool = {
      path: spoolPath,
      size: actualSize,
      checksumSha256: hash.digest("hex"),
      openStream: () => createReadStream(spoolPath),
    }
    return await callback(spool)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
