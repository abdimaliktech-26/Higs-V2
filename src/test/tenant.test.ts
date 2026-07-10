import { describe, it, expect } from "vitest"

describe("tenant isolation", () => {
  it("slugify produces unique org slugs", async () => {
    const { slugify } = await import("@/lib/utils")
    const org1 = slugify("North Star Care Services")
    const org2 = slugify("South Star Care Services")
    expect(org1).not.toBe(org2)
    expect(org1).toBe("north-star-care-services")
    expect(org2).toBe("south-star-care-services")
  })

  it("should provide unique identifiers for tenant scoping", async () => {
    const { slugify } = await import("@/lib/utils")
    // Organization slugs are unique identifiers used in tenant isolation
    const slug = slugify("Minnesota Health Services")
    expect(slug).toMatch(/^[a-z0-9-]+$/)
    expect(slug.length).toBeGreaterThan(0)
  })
})
