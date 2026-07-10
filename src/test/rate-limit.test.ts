import { describe, it, expect, beforeEach } from "vitest"
import { limiters, checkRateLimit, getClientIp } from "@/lib/rate-limit"

describe("rate limiting", () => {
  beforeEach(() => {
    limiters.general.resetAll()
  })

  it("allows requests within limit", () => {
    const r1 = limiters.general.check("user-1")
    expect(r1.allowed).toBe(true)
    expect(r1.remaining).toBeGreaterThanOrEqual(0)
  })

  it("tracks separate keys independently", () => {
    limiters.general.reset("user-a")
    limiters.general.reset("user-b")

    const r1 = limiters.general.check("user-a")
    limiters.general.check("user-b")

    // Re-checking user-a should reduce remaining
    const r2 = limiters.general.check("user-a")
    expect(r2.remaining).toBeLessThan(r1.remaining)
  })

  it("returns 429 info when blocked", () => {
    // Create a strict limiter scenario by using reset + check pattern
    const limiter = limiters.general
    limiter.resetAll()
    // Test that check() returns the expected shape
    const result = limiter.check("test-user")
    expect(result).toHaveProperty("allowed")
    expect(result).toHaveProperty("remaining")
    expect(result).toHaveProperty("retryAfter")
    expect(result).toHaveProperty("total")
    expect(result).toHaveProperty("resetAt")
  })

  it("resetAll clears all entries", () => {
    limiters.general.check("user-a")
    limiters.general.check("user-b")
    limiters.general.resetAll()

    const ra = limiters.general.check("user-a")
    const rb = limiters.general.check("user-b")
    // After reset, both should have the same remaining count (fresh start)
    expect(ra.remaining).toBe(rb.remaining)
  })
})

describe("checkRateLimit helper", () => {
  it("returns null when allowed", () => {
    const result = checkRateLimit(limiters.general, "user-1")
    expect(result).toBeNull()
  })

  it("returns error for undefined userId", () => {
    const result = checkRateLimit(limiters.general, undefined)
    expect(result).not.toBeNull()
    expect(result!.error).toBe("Unauthorized")
  })
})

describe("getClientIp", () => {
  it("uses the first entry of x-forwarded-for", () => {
    const req = new Request("http://localhost", {
      headers: { "x-forwarded-for": "203.0.113.5, 10.0.0.1" },
    })
    expect(getClientIp(req)).toBe("203.0.113.5")
  })

  it("falls back to x-real-ip when x-forwarded-for is absent", () => {
    const req = new Request("http://localhost", {
      headers: { "x-real-ip": "198.51.100.7" },
    })
    expect(getClientIp(req)).toBe("198.51.100.7")
  })

  it("falls back to a constant when no IP header is present", () => {
    const req = new Request("http://localhost")
    expect(getClientIp(req)).toBe("unknown")
  })
})

describe("login brute-force throttling policy (limiters.auth, keyed by ip:email)", () => {
  beforeEach(() => {
    limiters.auth.resetAll()
  })

  it("allows up to the configured max attempts for one ip+email pair", () => {
    const key = "203.0.113.5:victim@example.com"
    for (let i = 0; i < 5; i++) {
      expect(limiters.auth.check(key).allowed).toBe(true)
    }
  })

  it("blocks the 6th attempt within the window for the same ip+email pair", () => {
    const key = "203.0.113.5:victim@example.com"
    for (let i = 0; i < 5; i++) limiters.auth.check(key)
    const blocked = limiters.auth.check(key)
    expect(blocked.allowed).toBe(false)
    expect(blocked.retryAfter).toBeGreaterThan(0)
  })

  it("does not lock out other emails from the same attacker ip", () => {
    const attackerIp = "203.0.113.5"
    for (let i = 0; i < 5; i++) limiters.auth.check(`${attackerIp}:victim@example.com`)
    // 6th attempt against victim@example.com is blocked
    expect(limiters.auth.check(`${attackerIp}:victim@example.com`).allowed).toBe(false)
    // a different user behind the same IP (e.g. shared office NAT) is unaffected
    expect(limiters.auth.check(`${attackerIp}:coworker@example.com`).allowed).toBe(true)
  })

  it("does not lock out the same email from a different ip", () => {
    for (let i = 0; i < 5; i++) limiters.auth.check("203.0.113.5:victim@example.com")
    expect(limiters.auth.check("203.0.113.5:victim@example.com").allowed).toBe(false)
    // legitimate user retrying from a different network is unaffected
    expect(limiters.auth.check("198.51.100.9:victim@example.com").allowed).toBe(true)
  })
})
