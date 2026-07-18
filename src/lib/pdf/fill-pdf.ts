import "server-only"

import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib"

// Field geometry is stored in the editor's base-scale-1.5 canvas units
// (top-down). The PDF coordinate space is points (bottom-up); one canvas
// unit = 1/1.5 pt. This is the single conversion point between the two.
const BASE_SCALE = 1.5

const INK = rgb(0.05, 0.09, 0.32)
const CHECKED_VALUES = new Set(["true", "yes", "checked", "on", "x", "1"])

export interface FillableField {
  fieldType: string
  pageNumber: number
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  value: string | null
}

export interface SignatureEvidence {
  signerName: string
  signedAt: Date
}

export interface FillPdfInput {
  templatePdf: Uint8Array
  fields: FillableField[]
  /** Signed evidence keyed by the signature field's PdfField id. */
  signaturesByFieldId?: Map<string, SignatureEvidence>
  fieldIds?: string[]
}

interface Box {
  x: number
  yTop: number
  width: number
  height: number
}

function toBox(field: FillableField): Box | null {
  if (field.posX === null || field.posY === null) return null
  return {
    x: field.posX / BASE_SCALE,
    yTop: field.posY / BASE_SCALE,
    width: (field.width ?? 120) / BASE_SCALE,
    height: (field.height ?? 18) / BASE_SCALE,
  }
}

function fitFontSize(font: PDFFont, text: string, box: Box, preferred: number): number {
  let size = Math.min(preferred, Math.max(6, box.height - 3))
  while (size > 5 && font.widthOfTextAtSize(text, size) > box.width - 2) size -= 0.5
  return size
}

function drawSingleLine(page: PDFPage, font: PDFFont, text: string, box: Box, pageHeight: number, preferred = 9): void {
  const size = fitFontSize(font, text, box, preferred)
  let visible = text
  while (visible.length > 1 && font.widthOfTextAtSize(visible, size) > box.width - 2) visible = visible.slice(0, -1)
  page.drawText(visible, {
    x: box.x + 1,
    y: pageHeight - box.yTop - box.height + (box.height - size) / 2 + 1,
    size,
    font,
    color: INK,
  })
}

function wrapLines(font: PDFFont, text: string, maxWidth: number, size: number): string[] {
  const lines: string[] = []
  for (const paragraph of text.split(/\r?\n/)) {
    let current = ""
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = current ? `${current} ${word}` : word
      if (font.widthOfTextAtSize(candidate, size) <= maxWidth || !current) current = candidate
      else {
        lines.push(current)
        current = word
      }
    }
    lines.push(current)
  }
  return lines
}

/**
 * Renders entered values and signature evidence onto a COPY of the original
 * template PDF. The template bytes are never mutated in place, no page is
 * added, removed, resized, or rewritten — the official document remains
 * visually identical with values drawn into its blank spaces.
 */
export async function fillPdf(input: FillPdfInput): Promise<Uint8Array> {
  const document = await PDFDocument.load(input.templatePdf)
  const helvetica = await document.embedFont(StandardFonts.Helvetica)
  const oblique = await document.embedFont(StandardFonts.HelveticaOblique)
  const pages = document.getPages()

  input.fields.forEach((field, index) => {
    const box = toBox(field)
    const page = pages[field.pageNumber - 1]
    if (!box || !page) return
    const pageHeight = page.getHeight()

    if (field.fieldType === "signature") {
      const evidence = input.fieldIds ? input.signaturesByFieldId?.get(input.fieldIds[index]) : undefined
      if (!evidence) return
      const nameBox: Box = { ...box, height: Math.max(10, box.height - 8) }
      drawSingleLine(page, oblique, evidence.signerName, nameBox, pageHeight, 12)
      page.drawText(`Electronically signed ${evidence.signedAt.toISOString().slice(0, 10)}`, {
        x: box.x + 1,
        y: pageHeight - box.yTop - box.height + 1,
        size: 5.5,
        font: helvetica,
        color: INK,
      })
      return
    }

    const value = field.value?.trim()
    if (!value) return

    if (field.fieldType === "checkbox") {
      if (!CHECKED_VALUES.has(value.toLowerCase())) return
      drawSingleLine(page, helvetica, "X", box, pageHeight, Math.min(11, box.height))
      return
    }

    if (field.fieldType === "textarea") {
      const size = 8
      const lines = wrapLines(helvetica, value, box.width - 2, size)
      const lineHeight = size + 2
      const maxLines = Math.max(1, Math.floor(box.height / lineHeight))
      lines.slice(0, maxLines).forEach((line, lineIndex) => {
        page.drawText(line, {
          x: box.x + 1,
          y: pageHeight - box.yTop - (lineIndex + 1) * lineHeight + 2,
          size,
          font: helvetica,
          color: INK,
        })
      })
      return
    }

    // text, date, select
    drawSingleLine(page, helvetica, value, box, pageHeight)
  })

  return document.save()
}
