"use client"

import { Suspense, useState, useCallback } from "react"
import { signIn } from "next-auth/react"
import { useRouter, useSearchParams } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card"
import { Lock, Mail, Eye, EyeOff } from "lucide-react"

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const callbackUrl = searchParams.get("callbackUrl") || "/dashboard"

  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      })

      if (result?.error) {
        setError(
          result.code === "too_many_attempts"
            ? "Too many attempts. Please wait a minute and try again."
            : "Invalid email or password"
        )
        setLoading(false)
        return
      }

      router.push(callbackUrl)
      router.refresh()
    } catch {
      setError("An unexpected error occurred. Please try again.")
      setLoading(false)
    }
  }

  return (
    <Card className="w-full">
      <CardHeader className="text-center pb-2">
        <CardTitle className="text-xl">Welcome back</CardTitle>
        <CardDescription>Sign in to your account to continue</CardDescription>
      </CardHeader>
      <form onSubmit={handleSubmit}>
        <CardContent className="space-y-4 pt-4">
          {error && (
            <div className="flex items-center gap-2 rounded-lg border border-danger-200 bg-danger-50 px-4 py-3 text-sm text-danger-700">
              <Lock className="h-4 w-4 shrink-0" />
              {error}
            </div>
          )}

          <Input
            label="Email"
            type="email"
            placeholder="you@organization.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            leftIcon={<Mail className="h-4 w-4" />}
            required
            autoFocus
            autoComplete="email"
          />

          <Input
            label="Password"
            type={showPassword ? "text" : "password"}
            placeholder="Enter your password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            leftIcon={<Lock className="h-4 w-4" />}
            rightIcon={
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="text-surface-400 hover:text-surface-600"
                tabIndex={-1}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            }
            required
            autoComplete="current-password"
          />
        </CardContent>

        <CardFooter className="flex-col gap-3">
          <Button type="submit" className="w-full" size="lg" loading={loading}>
            {loading ? "Signing in..." : "Sign in"}
          </Button>
        </CardFooter>
      </form>
    </Card>
  )
}

export default function LoginPage() {
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
              <p className="text-sm text-navy-300">Compliance Platform</p>
            </div>
          </div>

          <Suspense fallback={<Card className="w-full"><CardContent className="py-12 text-center text-sm text-surface-500">Loading...</CardContent></Card>}>
            <LoginForm />
          </Suspense>

          <div className="mt-8 flex items-center gap-2 text-xs text-navy-400">
            <Lock className="h-3 w-3" />
            Secure staff access
          </div>

          {process.env.NODE_ENV === "development" && (
          <div className="mt-8 rounded-lg border border-navy-700 bg-navy-800/50 p-4 w-full">
            <p className="mb-2 text-xs font-medium text-navy-300 uppercase tracking-wider">Development Accounts</p>
            <QuickFillLogin />
          </div>
          )}
        </div>
      </div>
    </div>
  )
}

function QuickFillLogin() {
  return (
    <div className="space-y-1.5">
      {[
        { role: "Super Admin", email: "superadmin@higsi.com" },
        { role: "Org Admin", email: "admin@northstar.com" },
        { role: "Compliance Director", email: "compliance@northstar.com" },
        { role: "Case Manager", email: "case@northstar.com" },
      ].map((acct) => (
        <div
          key={acct.email}
          className="flex w-full items-center justify-between rounded-md px-3 py-1.5 text-xs text-navy-300"
        >
          <span>{acct.role}</span>
          <span className="font-mono opacity-70">{acct.email}</span>
        </div>
      ))}
      <p className="mt-2 text-[10px] text-navy-500">Password: <span className="font-mono">password123</span></p>
    </div>
  )
}
