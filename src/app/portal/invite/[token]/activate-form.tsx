"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { activatePortalAccount } from "@/lib/actions/portal-invitations"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Lock, Mail } from "lucide-react"

interface Props {
  token: string
  invitedEmail: string
  isExistingPortalUser: boolean
}

export function ActivateForm({ token, invitedEmail, isExistingPortalUser }: Props) {
  const router = useRouter()
  const [password, setPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)

    if (!isExistingPortalUser && password !== confirmPassword) {
      setError("Passwords do not match.")
      return
    }

    setLoading(true)
    const result = await activatePortalAccount({ token, password })
    setLoading(false)

    if (result.success) {
      router.push("/portal/activation-success")
    } else {
      router.push(`/portal/activation-error?reason=${encodeURIComponent(result.error)}`)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && <Alert variant="error">{error}</Alert>}

      <Alert variant="info">
        By continuing, you confirm you are the person invited at <strong>{invitedEmail}</strong>, and you consent to accessing this client&apos;s portal information as authorized by their care team.
      </Alert>

      <Input label="Invited Email" value={invitedEmail} disabled leftIcon={<Mail className="h-4 w-4" />} />

      <Input
        label={isExistingPortalUser ? "Confirm your existing password" : "Create a password"}
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        leftIcon={<Lock className="h-4 w-4" />}
        required
        minLength={10}
        autoComplete={isExistingPortalUser ? "current-password" : "new-password"}
      />

      {!isExistingPortalUser && (
        <Input
          label="Confirm password"
          type="password"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          leftIcon={<Lock className="h-4 w-4" />}
          required
          minLength={10}
          autoComplete="new-password"
        />
      )}

      <Button type="submit" className="w-full" size="lg" loading={loading}>
        {loading ? "Activating..." : "Activate Account"}
      </Button>
    </form>
  )
}
