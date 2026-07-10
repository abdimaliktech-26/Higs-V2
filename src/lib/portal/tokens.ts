import { randomBytes, createHash, timingSafeEqual } from "crypto"

const RAW_TOKEN_BYTES = 32

/**
 * Generates a cryptographically random raw token plus its SHA-256 hash.
 * Only the hash is ever persisted — the raw value is returned once, to be
 * embedded in a link shown to staff, and must never be logged or stored.
 */
export function generatePortalToken(): { raw: string; hash: string } {
  const raw = randomBytes(RAW_TOKEN_BYTES).toString("hex")
  return { raw, hash: hashPortalToken(raw) }
}

export function hashPortalToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex")
}

/**
 * Constant-time comparison against a stored hash, to avoid timing side
 * channels on token lookup. Both inputs must be equal-length hex strings;
 * a length mismatch (malformed input) is treated as a mismatch, not an error.
 */
export function verifyPortalTokenHash(raw: string, storedHash: string): boolean {
  const candidate = hashPortalToken(raw)
  const a = Buffer.from(candidate, "hex")
  const b = Buffer.from(storedHash, "hex")
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
