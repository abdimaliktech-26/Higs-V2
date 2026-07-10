/**
 * Rate Limiter
 *
 * In-memory sliding window (default for local dev and single-instance).
 *
 * PRODUCTION: Replace with Redis via Upstash or similar:
 *   1. npm install @upstash/ratelimit @upstash/redis
 *   2. Set REDIS_URL or UPSTASH_REDIS_REST_URL
 *   3. Replace createMemoryLimiter below with:
 *        const { Ratelimit } = require("@upstash/ratelimit")
 *        const { Redis } = require("@upstash/redis")
 *        const redis = Redis.fromEnv()
 *        export const limiters = { check: (key) => Ratelimit.slidingWindow(max, window).limit(key) }
 *
 * The interface (check/reset/resetAll) is identical either way.
 */

export interface RateLimitResult {
  allowed: boolean
  remaining: number
  retryAfter: number
  total: number
  resetAt: number
}

interface Limiter {
  check(key: string): RateLimitResult
  reset(key: string): void
  resetAll(): void
}

interface WindowEntry {
  count: number
  resetAt: number
}

const stores = new Map<string, Map<string, WindowEntry>>()

function createMemoryLimiter(config: { windowMs: number; max: number; name?: string }): Limiter {
  const name = config.name || `mem:${config.windowMs}:${config.max}`
  let store = stores.get(name)
  if (!store) {
    store = new Map()
    stores.set(name, store)
  }

  if (typeof setInterval !== "undefined") {
    setInterval(() => {
      const cutoff = Date.now()
      for (const [key, entry] of store!) {
        if (entry.resetAt <= cutoff) store!.delete(key)
      }
    }, 60000).unref?.()
  }

  return {
    check(key: string): RateLimitResult {
      const entry = store!.get(key)
      const resetAt = Date.now() + config.windowMs

      if (!entry || entry.resetAt <= Date.now()) {
        store!.set(key, { count: 1, resetAt })
        return { allowed: true, remaining: config.max - 1, retryAfter: 0, total: config.max, resetAt }
      }

      entry.count++
      if (entry.count > config.max) {
        return {
          allowed: false, remaining: 0,
          retryAfter: Math.ceil((entry.resetAt - Date.now()) / 1000),
          total: config.max, resetAt: entry.resetAt,
        }
      }
      return { allowed: true, remaining: config.max - entry.count, retryAfter: 0, total: config.max, resetAt: entry.resetAt }
    },

    reset(key: string) { store!.delete(key) },
    resetAll() { store!.clear() },
  }
}

/**
 * Pre-configured limiters
 * PRODUCTION: Replace createMemoryLimiter with Redis-based implementation.
 */
export const limiters: Record<string, Limiter> = {
  upload: createMemoryLimiter({ windowMs: 60000, max: 10, name: "upload" }),
  fileAccess: createMemoryLimiter({ windowMs: 60000, max: 100, name: "fileAccess" }),
  auth: createMemoryLimiter({ windowMs: 60000, max: 5, name: "auth" }),
  ai: createMemoryLimiter({ windowMs: 60000, max: 10, name: "ai" }),
  validation: createMemoryLimiter({ windowMs: 60000, max: 20, name: "validation" }),
  signature: createMemoryLimiter({ windowMs: 60000, max: 30, name: "signature" }),
  general: createMemoryLimiter({ windowMs: 60000, max: 60, name: "general" }),
  portalInvitationView: createMemoryLimiter({ windowMs: 60000, max: 20, name: "portalInvitationView" }),
  portalActivation: createMemoryLimiter({ windowMs: 60000, max: 8, name: "portalActivation" }),
  portalLogin: createMemoryLimiter({ windowMs: 60000, max: 8, name: "portalLogin" }),
  portalFileAccess: createMemoryLimiter({ windowMs: 60000, max: 60, name: "portalFileAccess" }),
  portalUpload: createMemoryLimiter({ windowMs: 60000, max: 10, name: "portalUpload" }),
}

export function checkRateLimit(
  limiter: Limiter,
  userId: string | undefined,
): { success: false; error: string } | null {
  if (!userId) return { success: false, error: "Unauthorized" }
  const result = limiter.check(userId)
  if (!result.allowed) {
    return { success: false, error: `Too many requests. Try again in ${result.retryAfter} seconds.` }
  }
  return null
}

/**
 * Best-effort client IP from standard proxy headers (Vercel/most reverse proxies
 * set x-forwarded-for). Falls back to a constant so unauthenticated requests without
 * a resolvable IP still get bucketed together rather than bypassing the limiter.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for")
  if (forwardedFor) return forwardedFor.split(",")[0].trim()
  const realIp = request.headers.get("x-real-ip")
  if (realIp) return realIp.trim()
  return "unknown"
}
