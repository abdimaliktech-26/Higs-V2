export const MAX_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024

/** extension -> accepted MIME types (declared MIME is checked but never trusted alone) */
const ALLOWED_TYPES: Record<string, string[]> = {
  ".pdf": ["application/pdf"],
  ".jpg": ["image/jpeg"],
  ".jpeg": ["image/jpeg"],
  ".png": ["image/png"],
  ".heic": ["image/heic", "image/heif"],
  ".docx": ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
}

export type UploadValidationResult = { valid: true } | { valid: false; error: string }

/**
 * Strips any path components and disallowed characters from a filename
 * before it's ever used in a display context or stored as metadata. The
 * actual storage key is always separately generated (never derived from
 * this value), so this only protects the "original filename" metadata
 * field, not file placement on disk.
 */
export function sanitizeFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file"
  const stripped = base.replace(/^\.+/, "")
  const safe = stripped.replace(/[^a-zA-Z0-9 ._-]/g, "_").trim()
  return (safe || "file").slice(0, 200)
}

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".")
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : ""
}

/**
 * Checks the file's actual leading bytes against its claimed extension.
 * Only PDF/JPEG/PNG/DOCX(zip) have simple, reliable magic-byte signatures;
 * HEIC's ISOBMFF box structure is checked best-effort (presence of an
 * "ftyp" box), since a full brand-compatibility check is impractical here.
 */
function matchesFileSignature(buffer: Buffer, ext: string): boolean {
  switch (ext) {
    case ".pdf":
      return buffer.subarray(0, 4).toString("ascii") === "%PDF"
    case ".jpg":
    case ".jpeg":
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff
    case ".png":
      return buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    case ".docx":
      return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07)
    case ".heic":
      // Best-effort only: HEIC/HEIF is an ISOBMFF container — a real "ftyp"
      // box appears at offset 4 regardless of brand, but we do not attempt
      // to validate specific brand compatibility here.
      return buffer.length >= 12 && buffer.subarray(4, 8).toString("ascii") === "ftyp"
    default:
      return false
  }
}

export function validateUploadFile(input: { fileName: string; declaredMimeType: string; buffer: Buffer }): UploadValidationResult {
  if (input.buffer.length === 0) return { valid: false, error: "File is empty" }
  if (input.buffer.length > MAX_UPLOAD_SIZE_BYTES) return { valid: false, error: "File exceeds the 25 MB limit" }

  const ext = getExtension(input.fileName)
  const allowedMimes = ALLOWED_TYPES[ext]
  if (!allowedMimes) {
    return { valid: false, error: "Unsupported file type. Allowed: PDF, JPG, PNG, HEIC, DOCX" }
  }
  if (!allowedMimes.includes(input.declaredMimeType.toLowerCase())) {
    return { valid: false, error: "File type does not match its extension" }
  }
  if (!matchesFileSignature(input.buffer, ext)) {
    return { valid: false, error: "File content does not match its declared type" }
  }

  return { valid: true }
}
