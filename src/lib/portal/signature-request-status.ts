// Pure, framework-agnostic module — deliberately not "use server" (the same
// Next.js constraint discovered in Step 5b.2: a Server Actions file may
// only export async Server Functions). Shared by the dashboard prompt and
// the signing ceremony page so the two surfaces can never disagree about
// what counts as actionable.

export type PortalSignatureRequestState =
  | "NOT_FOUND"
  | "NOT_SIGNABLE_STATUS"
  | "NOT_ELIGIBLE"
  | "MISSING_CONSENT"
  | "SIGNABLE"

export interface PortalSignatureRequestLifecycleFields {
  status: string
  consentText: string
  eligible: boolean
}

export function derivePortalSignatureRequestState(
  req: PortalSignatureRequestLifecycleFields | null
): PortalSignatureRequestState {
  if (!req) return "NOT_FOUND"
  if (req.status !== "sent" && req.status !== "viewed") return "NOT_SIGNABLE_STATUS"
  if (!req.eligible) return "NOT_ELIGIBLE"
  if (!req.consentText.trim()) return "MISSING_CONSENT"
  return "SIGNABLE"
}
