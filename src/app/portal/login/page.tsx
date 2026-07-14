"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { portalLogin } from "@/lib/actions/portal-auth"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { Alert } from "@/components/ui/alert"
import { Lock, Mail } from "lucide-react"

export default function PortalLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)
    const result = await portalLogin({ email, password })
    setLoading(false)
    if (result.success) {
      router.push("/portal/dashboard")
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-navy-900">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex w-full max-w-[440px] flex-col items-center">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-lg">
              <span className="text-2xl font-bold text-brand-700">H</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Higsi</h1>
              <p className="text-sm text-navy-300">Client Portal</p>
            </div>
          </div>

          <Card className="w-full">
            <CardHeader>
              <CardTitle className="text-xl">Welcome back</CardTitle>
              <CardDescription>Sign in to view your information</CardDescription>
            </CardHeader>
            <form onSubmit={handleSubmit}>
              <CardContent className="space-y-4 pt-4">
                {error && <Alert variant="error">{error}</Alert>}
                <Input
                  label="Email" type="email" placeholder="you@example.com"
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  leftIcon={<Mail className="h-4 w-4" />} required autoFocus autoComplete="email"
                />
                <Input
                  label="Password" type="password" placeholder="Enter your password"
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  leftIcon={<Lock className="h-4 w-4" />} required autoComplete="current-password"
                />
              </CardContent>
              <CardFooter className="flex-col gap-3">
                <Button type="submit" className="w-full" size="lg" loading={loading}>
                  {loading ? "Signing in..." : "Sign in"}
                </Button>
              </CardFooter>
            </form>
          </Card>

          <div className="mt-8 flex items-center gap-2 text-xs text-navy-400">
            <Lock className="h-3 w-3" />
            Secure portal access
          </div>
        </div>
      </div>
    </div>
  )
}
