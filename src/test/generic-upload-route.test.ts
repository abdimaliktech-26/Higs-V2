import { describe, expect, it } from "vitest"

describe("generic upload route", () => {
  it("rejects unowned uploads so every stored file must originate from a resource-specific workflow", async () => {
    const { POST } = await import("@/app/api/upload/route")
    const response = await POST()
    expect(response.status).toBe(410)
    await expect(response.json()).resolves.toEqual({
      success: false,
      error: "Generic uploads are disabled. Use a resource-specific upload workflow.",
    })
  })
})
