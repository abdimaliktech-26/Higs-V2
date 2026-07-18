// @vitest-environment node
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { buildSyntheticPdf } from "../../scripts/upload-platform-verify"
import { TEMPLATE_PDF_PROFILE } from "@/lib/uploads/profiles"
import { validateUpload } from "@/lib/uploads/validation"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

describe("upload platform verification payloads", () => {
  it("builds a deep-validation-passing single-page PDF near the requested size", async () => {
    const targetBytes = 1024 * 1024
    const payload = buildSyntheticPdf(targetBytes)
    expect(Math.abs(payload.length - targetBytes)).toBeLessThan(1024)

    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "platform-verify-test-"))
    roots.push(directory)
    const file = path.join(directory, "synthetic.pdf")
    await fs.writeFile(file, payload)
    const result = await validateUpload({
      source: { path: file, size: payload.length, openStream: () => createReadStream(file) },
      extension: ".pdf",
      declaredMimeType: "application/pdf",
      policy: TEMPLATE_PDF_PROFILE,
    })
    expect(result.format).toBe("pdf")
    expect(result.structural.pageCount).toBe(1)
  })
})
