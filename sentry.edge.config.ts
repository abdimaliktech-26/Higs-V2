/**
 * Sentry edge configuration (for middleware/proxy)
 * Safe fallback if SENTRY_DSN is not set.
 */

const dsn = process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN

if (dsn) {
  void import("@sentry/nextjs").then((Sentry) => {
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || "development",
      tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0,
      sendDefaultPii: false,
      enabled: !!dsn,
    })
  })
}

export {}
