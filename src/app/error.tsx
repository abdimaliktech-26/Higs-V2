"use client"

import { useEffect } from "react"
import { Button } from "@/components/ui/button"
import { AlertTriangle } from "lucide-react"

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  useEffect(() => {
    // Log to console
    console.error(error)

    // Send to Sentry if available
    try {
      const dsn = typeof process !== "undefined"
        ? process.env.NEXT_PUBLIC_SENTRY_DSN
        : undefined
      if (dsn) {
        import("@sentry/nextjs").then((Sentry) => {
          Sentry.captureException(error)
        })
      }
    } catch {
      // Sentry not available — safe fallback
    }
  }, [error])

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-surface-50 p-8">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-danger-50 mb-6">
        <AlertTriangle className="h-8 w-8 text-danger-500" />
      </div>
      <h1 className="text-2xl font-bold text-surface-900 mb-2">Something went wrong</h1>
      <p className="text-surface-500 text-center max-w-md mb-6">
        An unexpected error occurred. Our team has been notified.
      </p>
      {error.digest && (
        <p className="text-xs text-surface-400 font-mono mb-4">Error ID: {error.digest}</p>
      )}
      <Button onClick={reset}>Try again</Button>
    </div>
  )
}
