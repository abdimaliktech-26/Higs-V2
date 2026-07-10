/**
 * Sentry server configuration
 *
 * Captures server-side errors.
 * Safe fallback if SENTRY_DSN is not set (no-op).
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
      beforeSend(event) {
        if (event?.exception?.values) {
          event.exception.values = event.exception.values.map((v) => ({
            ...v,
            value: v.value?.replace(/[\w.-]+@[\w.-]+\.\w+/g, "[email]"),
          }))
        }
        return event
      },
    })
  })
}

export {}
