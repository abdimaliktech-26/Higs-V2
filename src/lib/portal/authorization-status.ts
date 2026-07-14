// Pure, framework-agnostic module — deliberately not "use server" (this
// repo's Next.js build rejects a non-async export from a Server Actions
// file, the same constraint that put formatSignedFieldValue in its own
// file in Step 5a.1). Shared by the portal dashboard prompt and the
// authorization acceptance page so the two surfaces can never disagree
// about whether acceptance is currently actionable.

export type PortalAuthorizationState =
  | "NONE"
  | "PENDING_FUTURE"
  | "PENDING_ACTIONABLE"
  | "ACCEPTED"
  | "EXPIRED"
  | "REVOKED"

export interface PortalAuthorizationLifecycleFields {
  acceptedAt: Date | null
  revokedAt: Date | null
  effectiveDate: Date
  expirationDate: Date | null
}

// Precedence matches the staff-facing authorizationStatus() derivation
// from Step 5b.1: revoked beats expired beats accepted beats
// not-yet-effective.
export function derivePortalAuthorizationState(
  auth: PortalAuthorizationLifecycleFields | null,
  now: Date
): PortalAuthorizationState {
  if (!auth) return "NONE"
  if (auth.revokedAt) return "REVOKED"
  if (auth.expirationDate && auth.expirationDate <= now) return "EXPIRED"
  if (auth.acceptedAt) return "ACCEPTED"
  if (auth.effectiveDate > now) return "PENDING_FUTURE"
  return "PENDING_ACTIONABLE"
}
