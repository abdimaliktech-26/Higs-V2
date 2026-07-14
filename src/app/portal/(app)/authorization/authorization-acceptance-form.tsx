"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { acceptPortalAccessAuthorization } from "@/lib/actions/portal-access-authorizations"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"

interface Props {
  authorizationId: string
  backHref: string
}

// Step 5b.2 — approved, factual wording. Acceptance authorizes a later
// signing capability; it does not itself sign anything, and staff must
// still separately enable signing after this.
const EXPLANATION =
  "Accepting this authorization does not sign any document. A staff member must separately enable signing permission before you can sign documents through the portal."

const SUCCESS_MESSAGE = "Your acceptance has been recorded. A staff member must separately enable signing permission before you can sign documents through the portal."

// Matches the staff signing form's SUCCESS_REDIRECT_DELAY_MS convention —
// long enough for the confirmation to be genuinely perceivable and
// screen-reader-announced before navigating away.
const SUCCESS_REDIRECT_DELAY_MS = 1200

export function AuthorizationAcceptanceForm({ authorizationId, backHref }: Props) {
  const router = useRouter()
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState(false)

  const errorRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (serverError) errorRef.current?.focus()
  }, [serverError])

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    // Authoritative client-side guard against a double-click/double-submit
    // racing this same handler — the Button below is also disabled while
    // loading or after success.
    if (loading || success) return

    setServerError(null)
    setConsentError(null)

    if (!consentAccepted) {
      setConsentError("You must check this box to accept the authorization.")
      return
    }

    setLoading(true)
    const result = await acceptPortalAccessAuthorization(authorizationId)

    if (!result.success) {
      setLoading(false)
      setServerError(result.error)
      return
    }

    setSuccess(true)
    setTimeout(() => {
      router.push(backHref)
      router.refresh()
    }, SUCCESS_REDIRECT_DELAY_MS)
  }

  if (success) {
    return (
      <Card>
        <CardContent className="p-4">
          <div role="status">
            <Alert variant="success">{SUCCESS_MESSAGE}</Alert>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <form onSubmit={handleSubmit} noValidate>
        <CardContent className="space-y-4">
          {serverError && (
            <div ref={errorRef} role="alert" tabIndex={-1}>
              <Alert variant="error">{serverError}</Alert>
            </div>
          )}

          <div>
            <Checkbox
              label="I have read and understood the signing authorization statement above."
              checked={consentAccepted}
              onChange={(e) => setConsentAccepted(e.target.checked)}
              disabled={loading}
            />
            {consentError && <p className="mt-1 text-sm text-danger-600">{consentError}</p>}
          </div>

          <p className="text-sm text-surface-600">{EXPLANATION}</p>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => router.push(backHref)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={loading}>Accept Authorization</Button>
        </CardFooter>
      </form>
    </Card>
  )
}
