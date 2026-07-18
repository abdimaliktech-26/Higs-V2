// @vitest-environment node
import { describe, expect, it } from "vitest"
import { buildSyntheticPdf } from "../../scripts/upload-platform-verify"
import { fillPdf, type FillableField } from "@/lib/pdf/fill-pdf"

const BASE = 1.5

function field(overrides: Partial<FillableField> = {}): FillableField {
  return {
    fieldType: "text",
    pageNumber: 1,
    posX: 100 * BASE,
    posY: 200 * BASE,
    width: 200 * BASE,
    height: 14 * BASE,
    value: "Jane Doe",
    ...overrides,
  }
}

async function extractText(bytes: Uint8Array): Promise<string[]> {
  const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
  const task = getDocument({ data: bytes.slice(), useWorkerFetch: false })
  const document = await task.promise
  const pages: string[] = []
  for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber++) {
    const page = await document.getPage(pageNumber)
    const content = await page.getTextContent()
    pages.push((content.items as { str: string }[]).map((item) => item.str).join(" "))
  }
  return pages
}

describe("filled-PDF generation", () => {
  it("draws entered values onto a copy of the original without altering the template bytes", async () => {
    const template = buildSyntheticPdf(64 * 1024)
    const before = Buffer.from(template)
    const output = await fillPdf({ templatePdf: new Uint8Array(template), fields: [field()] })

    expect(Buffer.compare(before, template)).toBe(0) // input untouched
    const pages = await extractText(output)
    expect(pages).toHaveLength(1) // no pages added or removed
    expect(pages[0]).toContain("Jane Doe")
  })

  it("renders checkboxes as X only when checked and skips empty values", async () => {
    const template = buildSyntheticPdf(64 * 1024)
    const output = await fillPdf({
      templatePdf: new Uint8Array(template),
      fields: [
        field({ fieldType: "checkbox", value: "true", posX: 50 * BASE }),
        field({ fieldType: "checkbox", value: "false", posX: 80 * BASE }),
        field({ value: "   " }),
        field({ value: null }),
      ],
    })
    const pages = await extractText(output)
    expect(pages[0].match(/X/g)?.length ?? 0).toBe(1)
    expect(pages[0]).not.toContain("Jane Doe")
  })

  it("renders a signature only when signed evidence exists, with the audit line", async () => {
    const template = buildSyntheticPdf(64 * 1024)
    const signatureField = field({ fieldType: "signature", value: null })
    const unsignedField = field({ fieldType: "signature", value: null, posX: 300 * BASE })
    const output = await fillPdf({
      templatePdf: new Uint8Array(template),
      fields: [signatureField, unsignedField],
      fieldIds: ["sig-1", "sig-2"],
      signaturesByFieldId: new Map([["sig-1", { signerName: "Sarah Johnson", signedAt: new Date("2026-07-18T12:00:00Z") }]]),
    })
    const pages = await extractText(output)
    expect(pages[0]).toContain("Sarah Johnson")
    expect(pages[0]).toContain("Electronically signed 2026-07-18")
    expect(pages[0].match(/Electronically signed/g)?.length).toBe(1)
  })

  it("wraps textarea values and never overflows the declared box height", async () => {
    const template = buildSyntheticPdf(64 * 1024)
    const longText = Array.from({ length: 40 }, (_, index) => `word${index}`).join(" ")
    const output = await fillPdf({
      templatePdf: new Uint8Array(template),
      fields: [field({ fieldType: "textarea", value: longText, height: 22 * BASE })],
    })
    const pages = await extractText(output)
    expect(pages[0]).toContain("word0")
    // Two ~10pt lines fit in a 22pt box; later words must have been clipped.
    expect(pages[0]).not.toContain("word39")
  })

  it("ignores fields on pages that do not exist rather than corrupting output", async () => {
    const template = buildSyntheticPdf(64 * 1024)
    const output = await fillPdf({
      templatePdf: new Uint8Array(template),
      fields: [field({ pageNumber: 9 })],
    })
    const pages = await extractText(output)
    expect(pages).toHaveLength(1)
    expect(pages[0]).not.toContain("Jane Doe")
  })
})
