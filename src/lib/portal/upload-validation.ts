// PR-5B.3 moved portal upload content validation into the shared scanned
// upload pipeline (src/lib/uploads/validation); only filename sanitization
// remains here. PR-5B.4 removed the superseded buffer-based validator.

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
