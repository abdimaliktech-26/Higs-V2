// Step 5a.1 — pure signature-domain formatting helpers. Deliberately not a
// "use server" module: every export from a "use server" file must be an
// async Server Function (confirmed by inspecting every existing action file
// in this codebase — none export a plain synchronous function), so this
// small, testable, dependency-free formatter lives in its own file and is
// imported by src/lib/actions/signatures.ts instead.
const SIGNED_VALUE_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

// The single, centralized formatter for what gets written into
// PdfField.value on execution. Deliberately UTC-based (never the server's
// local timezone) so the stored string is deterministic and testable
// regardless of where this runs. Contains only what a signature block needs
// to display: the normalized signer name, that it was electronically
// signed, and when — never IP, user-agent, email, consent text, or any
// other value that already has a proper, structured home on
// SignatureRequest/SignatureEvent.
export function formatSignedFieldValue(signerName: string, signedAt: Date): string {
  const month = SIGNED_VALUE_MONTHS[signedAt.getUTCMonth()]
  const day = signedAt.getUTCDate()
  const year = signedAt.getUTCFullYear()
  const hours24 = signedAt.getUTCHours()
  const minutes = String(signedAt.getUTCMinutes()).padStart(2, "0")
  const period = hours24 >= 12 ? "PM" : "AM"
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12
  return `${signerName} — electronically signed ${month} ${day}, ${year} at ${hours12}:${minutes} ${period} UTC`
}

// Deterministic, timezone-explicit signer-name normalization for comparing
// a typed name against SignatureRequest.signerName: trim, collapse internal
// whitespace, compare case-insensitively. Never used to silently rewrite
// the stored signerName.
export function normalizeSignerName(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase()
}

// Same trim/whitespace-collapse as normalizeSignerName, but preserving the
// signer's own casing — used for what actually gets displayed/stored (the
// field value), never for the case-insensitive match comparison above.
export function normalizeDisplayName(name: string): string {
  return name.trim().replace(/\s+/g, " ")
}
