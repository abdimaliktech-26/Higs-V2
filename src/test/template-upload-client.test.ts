import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { waitForTemplateUpload } from "@/lib/uploads/template-upload-client"

function response(body: unknown, ok = true): Pick<Response, "ok" | "json"> {
  return { ok, json: async () => body }
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal("fetch", vi.fn())
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe("template upload browser orchestration", () => {
  it("polls private status and completes only after CLEAN", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ success: true, data: { status: "SCANNING", malwareStatus: "PENDING" } }) as Response)
      .mockResolvedValueOnce(response({ success: true, data: { status: "SCANNING", malwareStatus: "CLEAN" } }) as Response)
      .mockResolvedValueOnce(response({ success: true, data: { templateId: "template", ownerId: "template", version: 2 } }) as Response)
    const resultPromise = waitForTemplateUpload("attempt")
    await vi.runAllTimersAsync()
    await expect(resultPromise).resolves.toEqual({ templateId: "template", version: 2 })
    expect(vi.mocked(fetch).mock.calls[2]).toEqual(["/api/uploads/attempt/complete", { method: "POST" }])
  })

  it("never invokes completion for a failed scan", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, data: { status: "FAILED", malwareStatus: "INFECTED" } }) as Response)
    await expect(waitForTemplateUpload("attempt")).rejects.toThrow(/did not pass/i)
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("returns an already completed owner without another write", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: true, data: { status: "COMPLETED", ownerId: "template" } }) as Response)
    await expect(waitForTemplateUpload("attempt")).resolves.toEqual({ templateId: "template" })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it("propagates bounded status-route failures", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(response({ success: false, error: "Access denied" }, false) as Response)
    await expect(waitForTemplateUpload("attempt")).rejects.toThrow("Access denied")
  })

  it("propagates completion refusal without exposing storage details", async () => {
    vi.mocked(fetch)
      .mockResolvedValueOnce(response({ success: true, data: { status: "SCANNING", malwareStatus: "CLEAN" } }) as Response)
      .mockResolvedValueOnce(response({ success: false, error: "The verified malware scan is not complete." }, false) as Response)
    await expect(waitForTemplateUpload("attempt")).rejects.toThrow(/scan is not complete/i)
  })
})
