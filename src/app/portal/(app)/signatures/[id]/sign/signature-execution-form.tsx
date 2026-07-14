"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { executePortalSignature } from "@/lib/actions/signatures"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Checkbox } from "@/components/ui/checkbox"
import { Card, CardContent, CardFooter } from "@/components/ui/card"
import { Alert } from "@/components/ui/alert"
import { formatDateTime } from "@/lib/utils"

interface Props {
  requestId: string
  clientId: string
  expectedSignerName: string
}

// Step 5c.3 — approved, factual final-action wording, matching the exact
// tone already approved for staff self-signing (Step 5a.2) and the portal
// authorization ceremony (Step 5b.2). Makes no claim about legal effect
// beyond what the reviewed consent language above this form establishes.
const FINAL_ACKNOWLEDGEMENT =
  "By completing this action, you confirm that you are the named signer and that you agree to the consent terms above. This electronic signature is final and cannot be undone."

const SUCCESS_MESSAGE = "Your electronic signature was completed successfully."

// Matches the exact SUCCESS_REDIRECT_DELAY_MS convention already
// established for both prior signing/consent ceremonies in this codebase.
const SUCCESS_REDIRECT_DELAY_MS = 1200

interface SuccessState {
  signedAt: string
  remainingIncompleteSignatures: number
  allRequiredSignaturesComplete: boolean
}

// Pure UI client of executePortalSignature (Step 5c.2) — introduces no
// signing business logic of its own. Every authorization, status-
// precondition, and integrity check happens server-side inside that
// action; client-side validation here only improves the UX for the two
// cases a signer can trivially self-correct (blank name, unchecked
// consent) and is never treated as the security boundary.
export function SignatureExecutionForm({ requestId, clientId, expectedSignerName }: Props) {
  const router = useRouter()
  const [signerName, setSignerName] = useState("")
  const [consentAccepted, setConsentAccepted] = useState(false)
  const [nameError, setNameError] = useState<string | null>(null)
  const [consentError, setConsentError] = useState<string | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [success, setSuccess] = useState<SuccessState | null>(null)

  const nameInputRef = useRef<HTMLInputElement>(null)
  const errorRef = useRef<HTMLDivElement>(null)

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (loading || success) return

    setServerError(null)
    setNameError(null)
    setConsentError(null)

    const trimmedName = signerName.trim()
    let hasClientError = false
    if (!trimmedName) {
      setNameError("Enter your name to sign.")
      hasClientError = true
    }
    if (!consentAccepted) {
      setConsentError("You must accept the consent statement to sign.")
      hasClientError = true
    }
    if (hasClientError) {
      if (!trimmedName) nameInputRef.current?.focus()
      return
    }

    setLoading(true)
    const result = await executePortalSignature(requestId, { signerName, consentAccepted })

    if (!result.success) {
      setLoading(false)
      setServerError(result.error)
      requestAnimationFrame(() => errorRef.current?.focus())
      return
    }

    setSuccess({
      signedAt: result.data.signedAt,
      remainingIncompleteSignatures: result.data.remainingIncompleteSignatures,
      allRequiredSignaturesComplete: result.data.allRequiredSignaturesComplete,
    })

    setTimeout(() => {
      router.push(`/portal/dashboard?client=${clientId}`)
      router.refresh()
    }, SUCCESS_REDIRECT_DELAY_MS)
  }

  if (success) {
    return (
      <Card>
        <CardContent className="p-4">
          <div role="status">
            <Alert variant="success">
              <p className="font-medium">{SUCCESS_MESSAGE}</p>
              <p className="mt-1 text-xs opacity-90">
                Signed {formatDateTime(success.signedAt)}.{" "}
                {success.allRequiredSignaturesComplete
                  ? "All tracked signature requests for this packet are now complete."
                  : `${success.remainingIncompleteSignatures} signature request${success.remainingIncompleteSignatures === 1 ? "" : "s"} still open for this packet.`}
              </p>
            </Alert>
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

          <Input
            ref={nameInputRef}
            label="Your full name"
            hint={`Must match the signer name on this request: ${expectedSignerName}.`}
            error={nameError || undefined}
            value={signerName}
            onChange={(e) => setSignerName(e.target.value)}
            disabled={loading}
            autoComplete="off"
          />

          <div>
            <Checkbox
              label="I have read and agree to the consent terms above."
              checked={consentAccepted}
              onChange={(e) => setConsentAccepted(e.target.checked)}
              disabled={loading}
            />
            {consentError && <p className="mt-1 text-sm text-danger-600">{consentError}</p>}
          </div>

          <p className="text-sm text-surface-600">{FINAL_ACKNOWLEDGEMENT}</p>
        </CardContent>
        <CardFooter className="flex items-center justify-between gap-3">
          <Button type="button" variant="ghost" onClick={() => router.push(`/portal/dashboard?client=${clientId}`)}>Cancel</Button>
          <Button type="submit" variant="primary" loading={loading}>Complete Signature</Button>
        </CardFooter>
      </form>
    </Card>
  )
}
