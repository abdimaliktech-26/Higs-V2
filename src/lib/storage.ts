import fs from "fs/promises"
import path from "path"
import crypto from "crypto"
import { pipeline } from "stream/promises"
import { createReadStream, createWriteStream } from "fs"
import { Readable } from "stream"
import { assertProductionSecurityEnvironment } from "./security-environment"

const STORAGE_ROOT = path.join(process.cwd(), "private", "data")
assertProductionSecurityEnvironment()
const SIGNING_KEY = process.env.FILE_SIGNING_KEY || crypto.randomBytes(32).toString("hex")
const SIGNED_URL_TTL_MS = 5 * 60 * 1000 // 5 minutes

export interface FileRecord {
  key: string
  url: string
  size: number
  mimeType: string
  originalName: string
}

export const STAFF_FILE_RESOURCE_TYPES = ["document_template", "packet_document", "pdf_version", "supporting_document"] as const
export type StaffFileResourceType = (typeof STAFF_FILE_RESOURCE_TYPES)[number]

function ensureDir(dir: string) {
  return fs.mkdir(dir, { recursive: true })
}

function getFilePath(key: string): string {
  const resolved = path.resolve(STORAGE_ROOT, key)
  const relative = path.relative(STORAGE_ROOT, resolved)
  const escapesRoot = relative.startsWith("..") || path.isAbsolute(relative)
  if (escapesRoot) {
    throw new Error(`Invalid file key: path traversal detected in "${key}"`)
  }
  return resolved
}

export function signUrl(fileKey: string): string {
  const expires = Date.now() + SIGNED_URL_TTL_MS
  const payload = `${fileKey}:${expires}`
  const signature = crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex").slice(0, 16)
  return `/api/files/${fileKey}?expires=${expires}&sig=${signature}`
}

export function verifySignedUrl(fileKey: string, expires: number, signature: string): boolean {
  const payload = `${fileKey}:${expires}`
  const expected = crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex").slice(0, 16)
  const isExpired = Date.now() > expires
  if (signature.length !== expected.length) return false
  return !isExpired && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

/**
 * Staff file links identify a database resource, never a raw storage key.
 * The route resolves the current file key and live authorization on every
 * request; the signature is only an anti-tampering/expiry control.
 */
export function signStaffFileUrl(resourceType: StaffFileResourceType, resourceId: string): string {
  const expires = Date.now() + SIGNED_URL_TTL_MS
  const payload = `${resourceType}:${resourceId}:${expires}`
  const signature = crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex").slice(0, 16)
  return `/api/files/${resourceType}/${resourceId}?expires=${expires}&sig=${signature}`
}

export function verifyStaffFileUrl(resourceType: StaffFileResourceType, resourceId: string, expires: number, signature: string): boolean {
  const payload = `${resourceType}:${resourceId}:${expires}`
  const expected = crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex").slice(0, 16)
  if (signature.length !== expected.length) return false
  return Date.now() <= expires && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export type PortalFileMode = "view" | "download"
export type PortalDocType = "packet_document" | "supporting_document"

/**
 * Separate signing scheme for portal document access, distinct from the
 * staff signUrl/verifySignedUrl above. Deliberately signs the document's
 * (type, id, mode) rather than a raw storage path — the portal-files route
 * re-derives portalVisible/permission state fresh from the database on every
 * request using this id, instead of trusting a file path to still be
 * currently shareable. Also still requires a live portal session cookie;
 * the signed URL alone is not a bearer credential.
 */
export function signPortalFileUrl(docType: PortalDocType, docId: string, mode: PortalFileMode): string {
  const expires = Date.now() + SIGNED_URL_TTL_MS
  const payload = `${docType}:${docId}:${mode}:${expires}`
  const signature = crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex").slice(0, 16)
  return `/api/portal-files/${docType}/${docId}?mode=${mode}&expires=${expires}&sig=${signature}`
}

export function verifyPortalFileUrl(docType: PortalDocType, docId: string, mode: PortalFileMode, expires: number, signature: string): boolean {
  const payload = `${docType}:${docId}:${mode}:${expires}`
  const expected = crypto.createHmac("sha256", SIGNING_KEY).update(payload).digest("hex").slice(0, 16)
  const isExpired = Date.now() > expires
  if (signature.length !== expected.length) return false
  return !isExpired && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export async function storeFile(
  key: string,
  buffer: Buffer,
  mimeType: string,
  originalName: string
): Promise<FileRecord> {
  const filePath = getFilePath(key)
  await ensureDir(path.dirname(filePath))
  await fs.writeFile(filePath, buffer)

  const stat = await fs.stat(filePath)
  return {
    key,
    url: `/api/files/${key}?direct=1`,
    size: stat.size,
    mimeType,
    originalName,
  }
}

export async function storeFileFromStream(
  key: string,
  readable: Readable,
  mimeType: string,
  originalName: string
): Promise<FileRecord> {
  const filePath = getFilePath(key)
  await ensureDir(path.dirname(filePath))
  const writeStream = createWriteStream(filePath)
  await pipeline(readable, writeStream)

  const stat = await fs.stat(filePath)
  return {
    key,
    url: `/api/files/${key}?direct=1`,
    size: stat.size,
    mimeType,
    originalName,
  }
}

export async function getFileStream(key: string): Promise<{ stream: fs.FileHandle; mimeType: string; size: number } | null> {
  try {
    const filePath = getFilePath(key)
    const stat = await fs.stat(filePath)
    if (!stat.isFile()) return null
    const handle = await fs.open(filePath, "r")
    // Infer mime from extension
    const ext = path.extname(key).toLowerCase()
    const mimeMap: Record<string, string> = { ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg" }
    return { stream: handle, mimeType: mimeMap[ext] || "application/octet-stream", size: stat.size }
  } catch {
    return null
  }
}

export async function deleteFile(key: string): Promise<boolean> {
  try {
    await fs.unlink(getFilePath(key))
    return true
  } catch {
    return false
  }
}

export async function fileExists(key: string): Promise<boolean> {
  try {
    const stat = await fs.stat(getFilePath(key))
    return stat.isFile()
  } catch {
    return false
  }
}

export { STORAGE_ROOT }
