// Stage 5 Step 5a.1 — pure signature-domain formatting helpers.
import { describe, it, expect } from "vitest"
import { formatSignedFieldValue, normalizeSignerName, normalizeDisplayName } from "@/lib/actions/signature-formatting"

describe("formatSignedFieldValue", () => {
  it("produces a deterministic, UTC-based, human-readable string", () => {
    const signedAt = new Date(Date.UTC(2026, 6, 13, 14, 14, 0)) // Jul 13, 2026, 14:14 UTC
    expect(formatSignedFieldValue("Jane Doe", signedAt)).toBe("Jane Doe — electronically signed Jul 13, 2026 at 2:14 PM UTC")
  })

  it("is unaffected by the process/server local timezone (UTC getters only)", () => {
    const signedAt = new Date(Date.UTC(2026, 0, 1, 0, 5, 0)) // Jan 1, 2026, 00:05 UTC
    expect(formatSignedFieldValue("John Smith", signedAt)).toBe("John Smith — electronically signed Jan 1, 2026 at 12:05 AM UTC")
  })

  it("formats midday (12 PM) correctly", () => {
    const signedAt = new Date(Date.UTC(2026, 5, 1, 12, 0, 0))
    expect(formatSignedFieldValue("Signer", signedAt)).toBe("Signer — electronically signed Jun 1, 2026 at 12:00 PM UTC")
  })

  it("never includes IP, user-agent, email, or consent text", () => {
    const value = formatSignedFieldValue("Jane Doe", new Date())
    expect(value).not.toMatch(/@/)
    expect(value).not.toMatch(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)
    expect(value).not.toContain("<")
    expect(value).not.toContain("{")
  })
})

describe("normalizeSignerName", () => {
  it("trims, collapses internal whitespace, and lowercases", () => {
    expect(normalizeSignerName("  Jane   Doe  ")).toBe("jane doe")
  })

  it("treats differently-cased, differently-spaced names as equal", () => {
    expect(normalizeSignerName(" Jane   Doe ")).toBe(normalizeSignerName("jane doe"))
  })

  it("does not treat genuinely different names as equal", () => {
    expect(normalizeSignerName("Jane Doe")).not.toBe(normalizeSignerName("John Doe"))
  })
})

describe("normalizeDisplayName", () => {
  it("trims and collapses whitespace but preserves casing", () => {
    expect(normalizeDisplayName("  jane   doe  ")).toBe("jane doe")
    expect(normalizeDisplayName("  Jane   Doe  ")).toBe("Jane Doe")
  })
})
