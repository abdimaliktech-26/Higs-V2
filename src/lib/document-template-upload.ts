export const MAX_TEMPLATE_UPLOAD_SIZE_BYTES = 25 * 1024 * 1024

/**
 * Strips path components and disallowed characters before a filename is
 * ever stored as metadata. The actual storage key is always generated
 * separately (never derived from this value), so this only protects the
 * "original filename" audit metadata, not file placement on disk.
 */
export function sanitizeTemplateFileName(name: string): string {
  const base = name.split(/[/\\]/).pop() || "file.pdf"
  const stripped = base.replace(/^\.+/, "")
  const safe = stripped.replace(/[^a-zA-Z0-9 ._-]/g, "_").trim()
  return (safe || "file.pdf").slice(0, 200)
}

export type TemplateUploadValidationResult = { valid: true } | { valid: false; error: string }

/** DocumentTemplate uploads are PDF-only — checked by extension, declared MIME, and leading magic bytes. */
export function validateTemplatePdfUpload(input: { fileName: string; declaredMimeType: string; buffer: Buffer }): TemplateUploadValidationResult {
  if (input.buffer.length === 0) return { valid: false, error: "File is empty" }
  if (input.buffer.length > MAX_TEMPLATE_UPLOAD_SIZE_BYTES) return { valid: false, error: "File exceeds the 25 MB limit" }

  const isPdfExtension = input.fileName.toLowerCase().endsWith(".pdf")
  if (!isPdfExtension) return { valid: false, error: "Only PDF files are accepted" }
  if (input.declaredMimeType.toLowerCase() !== "application/pdf") {
    return { valid: false, error: "File type does not match its extension" }
  }
  if (input.buffer.subarray(0, 4).toString("ascii") !== "%PDF") {
    return { valid: false, error: "File content does not match its declared type" }
  }

  return { valid: true }
}
