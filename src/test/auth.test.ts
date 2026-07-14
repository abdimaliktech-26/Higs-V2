import { describe, it, expect } from "vitest"

describe("utils", () => {
  it("slugify should convert text to URL-safe slugs", async () => {
    const { slugify } = await import("@/lib/utils")
    expect(slugify("North Star Care Services")).toBe("north-star-care-services")
    expect(slugify("hello-world")).toBe("hello-world")
    expect(slugify("  trim  ")).toBe("-trim-")
  })

  it("getInitials should return first two initials", async () => {
    const { getInitials } = await import("@/lib/utils")
    expect(getInitials("Ayaan Mohamed")).toBe("AM")
    expect(getInitials("John")).toBe("J")
    expect(getInitials(null)).toBe("?")
    expect(getInitials(undefined)).toBe("?")
  })

  it("formatDate should handle null/undefined", async () => {
    const { formatDate } = await import("@/lib/utils")
    expect(formatDate(null)).toBe("—")
    expect(formatDate(undefined)).toBe("—")
  })

  it("cn should merge class names correctly", async () => {
    const { cn } = await import("@/lib/utils")
    expect(cn("px-4", "py-2")).toBe("px-4 py-2")
    expect(cn("px-4", false && "hidden")).toBe("px-4")
    expect(cn("px-4", undefined, "py-2")).toBe("px-4 py-2")
  })

  it("truncate should shorten strings", async () => {
    const { truncate } = await import("@/lib/utils")
    expect(truncate("Hello World", 5)).toBe("Hello…")
    expect(truncate("Hi", 5)).toBe("Hi")
  })

  it("formatDate should format Date objects", async () => {
    const { formatDate } = await import("@/lib/utils")
    const d = new Date("2024/06/15")
    const result = formatDate(d)
    expect(result).toContain("Jun")
    expect(result).toContain("15")
    expect(result).toContain("2024")
  })
})

describe("storage", () => {
  it("file storage signing and verification works", async () => {
    const { signUrl, verifySignedUrl } = await import("@/lib/storage")

    const fileKey = "templates/test.pdf"
    const signedUrl = signUrl(fileKey)

    expect(signedUrl).toContain("/api/files/templates/test.pdf")
    expect(signedUrl).toContain("expires=")
    expect(signedUrl).toContain("sig=")

    const url = new URL(signedUrl, "http://localhost")
    const expires = parseInt(url.searchParams.get("expires") || "0")
    const sig = url.searchParams.get("sig") || ""

    expect(verifySignedUrl(fileKey, expires, sig)).toBe(true)
    expect(verifySignedUrl(fileKey, expires + 999999999, sig)).toBe(false)
    expect(verifySignedUrl("wrong-key", expires, sig)).toBe(false)
    expect(verifySignedUrl(fileKey, expires, "short")).toBe(false)
  })

  it("staff file links sign a database resource identity instead of a storage key", async () => {
    const { signStaffFileUrl, verifyStaffFileUrl } = await import("@/lib/storage")
    const signedUrl = signStaffFileUrl("packet_document", "document-1")
    expect(signedUrl).toContain("/api/files/packet_document/document-1")
    expect(signedUrl).not.toContain("templates/test.pdf")

    const url = new URL(signedUrl, "http://localhost")
    const expires = parseInt(url.searchParams.get("expires") || "0")
    const signature = url.searchParams.get("sig") || ""
    expect(verifyStaffFileUrl("packet_document", "document-1", expires, signature)).toBe(true)
    expect(verifyStaffFileUrl("packet_document", "document-2", expires, signature)).toBe(false)
    expect(verifyStaffFileUrl("pdf_version", "document-1", expires, signature)).toBe(false)
    expect(verifyStaffFileUrl("packet_document", "document-1", expires, "short")).toBe(false)
  })
})
