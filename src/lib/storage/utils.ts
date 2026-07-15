import crypto from "crypto"
import { Readable, Transform } from "stream"
import { pipeline } from "stream/promises"
import type { StorageBody } from "./types"
import { StorageConfigurationError, StorageIntegrityError } from "./errors"

export function normalizeSha256(value: string): string {
  const normalized = value.trim().toLowerCase()
  if (!/^[a-f0-9]{64}$/.test(normalized)) throw new StorageIntegrityError("The SHA-256 checksum is invalid")
  return normalized
}

export function bodyAsReadable(body: StorageBody): Readable {
  if (body instanceof Readable) return body
  return Readable.from(Buffer.from(body))
}

export async function collectBody(body: StorageBody): Promise<Buffer> {
  const chunks: Buffer[] = []
  for await (const chunk of bodyAsReadable(body)) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

export function sha256Hex(data: Buffer | Uint8Array): string {
  return crypto.createHash("sha256").update(data).digest("hex")
}

export async function pipeAndHash(body: StorageBody, destination: NodeJS.WritableStream): Promise<{ checksumSha256: string; size: number }> {
  const hash = crypto.createHash("sha256")
  let size = 0
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      hash.update(value)
      size += value.length
      callback(null, value)
    },
  })
  await pipeline(bodyAsReadable(body), meter, destination)
  return { checksumSha256: hash.digest("hex"), size }
}

export function verifyExpectedIntegrity(input: { actualChecksum: string; actualSize: number; expectedChecksum?: string; expectedSize?: number }): void {
  if (input.expectedChecksum && normalizeSha256(input.expectedChecksum) !== input.actualChecksum) {
    throw new StorageIntegrityError("The stored object checksum did not match the expected checksum")
  }
  if (input.expectedSize !== undefined && input.expectedSize !== input.actualSize) {
    throw new StorageIntegrityError("The stored object size did not match the expected content length")
  }
}

export function validateSignedUrlTtl(seconds: number): number {
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 60) {
    throw new StorageConfigurationError("Signed storage URLs must expire between 1 and 60 seconds")
  }
  return seconds
}
