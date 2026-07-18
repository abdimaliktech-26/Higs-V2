import { open, readFile } from "node:fs/promises"
import { extname } from "node:path"
import { UploadFailureCategory } from "@prisma/client"
import { unzipSync } from "fflate"
import sharp from "sharp"
import { UploadValidationError } from "../errors"
import type {
  UploadFileFormat,
  UploadStructuralMetadata,
  UploadValidationInput,
  UploadValidationPolicy,
  UploadValidationResult,
  UploadValidationSource,
} from "../types"

export interface DeepUploadValidator {
  readonly format: UploadFileFormat
  validate(source: UploadValidationSource, policy: UploadValidationPolicy): Promise<UploadStructuralMetadata>
}

const FORMAT_MIME: Record<UploadFileFormat, string> = {
  pdf: "application/pdf",
  jpeg: "image/jpeg",
  png: "image/png",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

function malformed(safeDiagnostic: string): UploadValidationError {
  return new UploadValidationError(
    "MALFORMED_CONTENT",
    "The uploaded file is malformed or unsupported.",
    UploadFailureCategory.MALFORMED_CONTENT,
    safeDiagnostic,
  )
}

async function readMagic(path: string): Promise<Buffer> {
  const handle = await open(path, "r")
  try {
    const buffer = Buffer.alloc(16)
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
    return buffer.subarray(0, bytesRead)
  } finally {
    await handle.close()
  }
}

function detectFormat(magic: Buffer): UploadFileFormat | null {
  if (magic.subarray(0, 5).equals(Buffer.from("%PDF-"))) return "pdf"
  if (magic.length >= 3 && magic[0] === 0xff && magic[1] === 0xd8 && magic[2] === 0xff) return "jpeg"
  if (magic.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "png"
  if (magic.length >= 4 && magic[0] === 0x50 && magic[1] === 0x4b && magic[2] === 0x03 && magic[3] === 0x04) return "docx"
  return null
}

/**
 * PR-5C.2 backfill helper: bounded magic-byte sniff of an on-disk file.
 * Returns the detected pipeline format and its canonical MIME type, or null
 * when the bytes match no accepted format (for example legacy HEIC).
 */
export async function sniffUploadFile(path: string): Promise<{ format: UploadFileFormat; mimeType: string } | null> {
  const format = detectFormat(await readMagic(path))
  if (!format) return null
  return { format, mimeType: FORMAT_MIME[format] }
}

function normalizeExtension(extension: string): string {
  const normalized = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`
  return extname(`file${normalized}`)
}

class PdfValidator implements DeepUploadValidator {
  readonly format = "pdf" as const

  async validate(source: UploadValidationSource, policy: UploadValidationPolicy): Promise<UploadStructuralMetadata> {
    const { getDocument } = await import("pdfjs-dist/legacy/build/pdf.mjs")
    let task: ReturnType<typeof getDocument> | undefined
    try {
      // Receipt remains streaming and disk-spooled. PDF.js requires bounded
      // random-access parser input, so only the already size-limited spool is
      // materialized for this structural pass.
      task = getDocument({ data: new Uint8Array(await readFile(source.path)), stopAtErrors: true, useWorkerFetch: false })
      const document = await task.promise
      if (document.numPages < 1 || document.numPages > policy.pdf.maxPages) throw malformed("PDF_PAGE_LIMIT")
      if (document.isPureXfa) {
        throw new UploadValidationError(
          "ACTIVE_CONTENT",
          "Dynamic PDF content is not allowed.",
          UploadFailureCategory.ACTIVE_CONTENT,
          "PDF_XFA",
        )
      }

      const [attachments, javaScript] = await Promise.all([document.getAttachments(), document.getJSActions()])
      if (attachments && Object.keys(attachments).length > 0) {
        throw new UploadValidationError(
          "ACTIVE_CONTENT",
          "Embedded PDF files are not allowed.",
          UploadFailureCategory.ACTIVE_CONTENT,
          "PDF_EMBEDDED_FILE",
        )
      }
      if (javaScript && Object.keys(javaScript).length > 0) {
        throw new UploadValidationError(
          "ACTIVE_CONTENT",
          "PDF JavaScript is not allowed.",
          UploadFailureCategory.ACTIVE_CONTENT,
          "PDF_JAVASCRIPT",
        )
      }

      const prohibitedToken = await findPdfProhibitedToken(source)
      if (prohibitedToken) {
        throw new UploadValidationError(
          prohibitedToken.category === UploadFailureCategory.ENCRYPTED_PDF ? "ENCRYPTED_PDF" : "ACTIVE_CONTENT",
          prohibitedToken.category === UploadFailureCategory.ENCRYPTED_PDF
            ? "Encrypted or password-protected PDFs are not allowed."
            : "Active PDF content is not allowed.",
          prohibitedToken.category,
          prohibitedToken.code,
        )
      }

      return { pageCount: document.numPages }
    } catch (error) {
      if (error instanceof UploadValidationError) throw error
      if (error instanceof Error && (error.name === "PasswordException" || /password/i.test(error.name))) {
        throw new UploadValidationError(
          "ENCRYPTED_PDF",
          "Encrypted or password-protected PDFs are not allowed.",
          UploadFailureCategory.ENCRYPTED_PDF,
          "PDF_ENCRYPTED",
        )
      }
      throw malformed("PDF_PARSE_FAILED")
    } finally {
      await task?.destroy().catch(() => undefined)
    }
  }
}

async function findPdfProhibitedToken(
  source: UploadValidationSource,
): Promise<{ code: string; category: UploadFailureCategory } | null> {
  const rules: Array<[RegExp, string, UploadFailureCategory]> = [
    [/(^|[^A-Za-z])\/Encrypt([^A-Za-z]|$)/, "PDF_ENCRYPTED", UploadFailureCategory.ENCRYPTED_PDF],
    [/(^|[^A-Za-z])\/(JavaScript|JS)([^A-Za-z]|$)/, "PDF_JAVASCRIPT_TOKEN", UploadFailureCategory.ACTIVE_CONTENT],
    [/(^|[^A-Za-z])\/Launch([^A-Za-z]|$)/, "PDF_LAUNCH_ACTION", UploadFailureCategory.ACTIVE_CONTENT],
    [/(^|[^A-Za-z])\/(EmbeddedFile|Filespec)([^A-Za-z]|$)/, "PDF_EMBEDDED_FILE_TOKEN", UploadFailureCategory.ACTIVE_CONTENT],
    [/(^|[^A-Za-z])\/XFA([^A-Za-z]|$)/, "PDF_XFA_TOKEN", UploadFailureCategory.ACTIVE_CONTENT],
  ]
  let carry = ""
  for await (const chunk of source.openStream()) {
    const text = carry + Buffer.from(chunk as Uint8Array).toString("latin1")
    for (const [pattern, code, category] of rules) if (pattern.test(text)) return { code, category }
    carry = text.slice(-64)
  }
  return null
}

class ImageValidator implements DeepUploadValidator {
  constructor(readonly format: "jpeg" | "png") {}

  async validate(source: UploadValidationSource, policy: UploadValidationPolicy): Promise<UploadStructuralMetadata> {
    try {
      const image = sharp(source.path, {
        failOn: "warning",
        limitInputPixels: policy.image.maxPixels,
        sequentialRead: true,
      })
      const metadata = await image.metadata()
      const width = metadata.width ?? 0
      const height = metadata.height ?? 0
      const frames = metadata.pages ?? 1
      const channels = metadata.channels ?? 4
      if (metadata.format !== this.format || width < 1 || height < 1) throw malformed("IMAGE_FORMAT_INVALID")
      if (
        width > policy.image.maxWidth ||
        height > policy.image.maxHeight ||
        width * height > policy.image.maxPixels ||
        width * height * channels * frames > policy.image.maxDecompressedBytes ||
        frames > policy.image.maxFrames
      ) {
        throw malformed("IMAGE_RESOURCE_LIMIT")
      }
      await image.stats()
      return { width, height, frameCount: frames }
    } catch (error) {
      if (error instanceof UploadValidationError) throw error
      throw malformed("IMAGE_DECODE_FAILED")
    }
  }
}

interface ZipEntry {
  name: string
  compressedSize: number
  uncompressedSize: number
}

const REQUIRED_DOCX_ENTRIES = ["[Content_Types].xml", "_rels/.rels", "word/document.xml"] as const
const EXECUTABLE_EXTENSION = /\.(?:exe|dll|com|scr|bat|cmd|ps1|vbs|js|jar|msi)$/i

function inspectZipDirectory(buffer: Buffer, policy: UploadValidationPolicy): ZipEntry[] {
  const minimumEocd = 22
  let eocd = -1
  for (let offset = buffer.length - minimumEocd; offset >= Math.max(0, buffer.length - 65_557); offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw malformed("DOCX_ZIP_DIRECTORY_MISSING")

  const entryCount = buffer.readUInt16LE(eocd + 10)
  const directoryOffset = buffer.readUInt32LE(eocd + 16)
  if (entryCount < 1 || entryCount > policy.docx.maxEntries) throw malformed("DOCX_ENTRY_LIMIT")

  const entries: ZipEntry[] = []
  let cursor = directoryOffset
  let totalCompressed = 0
  let totalUncompressed = 0
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw malformed("DOCX_ZIP_DIRECTORY_INVALID")
    const compressedSize = buffer.readUInt32LE(cursor + 20)
    const uncompressedSize = buffer.readUInt32LE(cursor + 24)
    const nameLength = buffer.readUInt16LE(cursor + 28)
    const extraLength = buffer.readUInt16LE(cursor + 30)
    const commentLength = buffer.readUInt16LE(cursor + 32)
    if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) throw malformed("DOCX_ZIP64_UNSUPPORTED")
    const nameEnd = cursor + 46 + nameLength
    if (nameEnd > buffer.length) throw malformed("DOCX_ENTRY_NAME_INVALID")
    const name = buffer.subarray(cursor + 46, nameEnd).toString("utf8")
    const segments = name.replaceAll("\\", "/").split("/")
    if (name.startsWith("/") || name.includes("\\") || segments.some((segment) => segment === ".." || segment === ".")) {
      throw malformed("DOCX_TRAVERSAL_ENTRY")
    }
    if (EXECUTABLE_EXTENSION.test(name) || /(?:^|\/)vbaProject\.bin$/i.test(name)) throw malformed("DOCX_PROHIBITED_PAYLOAD")

    totalCompressed += compressedSize
    totalUncompressed += uncompressedSize
    if (totalCompressed > policy.docx.maxCompressedBytes || totalUncompressed > policy.docx.maxDecompressedBytes) {
      throw malformed("DOCX_ARCHIVE_SIZE_LIMIT")
    }
    if (compressedSize === 0 ? uncompressedSize > 0 : uncompressedSize / compressedSize > policy.docx.maxCompressionRatio) {
      throw malformed("DOCX_COMPRESSION_RATIO")
    }
    entries.push({ name, compressedSize, uncompressedSize })
    cursor = nameEnd + extraLength + commentLength
  }
  return entries
}

class DocxValidator implements DeepUploadValidator {
  readonly format = "docx" as const

  async validate(source: UploadValidationSource, policy: UploadValidationPolicy): Promise<UploadStructuralMetadata> {
    try {
      const buffer = await readFile(source.path)
      const entries = inspectZipDirectory(buffer, policy)
      const files = unzipSync(buffer)
      const names = new Set(Object.keys(files))
      if (REQUIRED_DOCX_ENTRIES.some((entry) => !names.has(entry))) throw malformed("DOCX_REQUIRED_ENTRY_MISSING")
      for (const [name, contents] of Object.entries(files)) {
        if (!name.endsWith(".rels") && name !== "[Content_Types].xml") continue
        const xml = Buffer.from(contents).toString("utf8")
        if (/TargetMode\s*=\s*["']External["']/i.test(xml)) throw malformed("DOCX_EXTERNAL_RELATIONSHIP")
        if (/macroEnabled|vbaProject/i.test(xml)) throw malformed("DOCX_MACRO_CONTENT")
      }
      return { archiveEntryCount: entries.length }
    } catch (error) {
      if (error instanceof UploadValidationError) throw error
      throw malformed("DOCX_PARSE_FAILED")
    }
  }
}

const VALIDATORS: Record<UploadFileFormat, DeepUploadValidator> = {
  pdf: new PdfValidator(),
  jpeg: new ImageValidator("jpeg"),
  png: new ImageValidator("png"),
  docx: new DocxValidator(),
}

export async function validateUpload(input: UploadValidationInput): Promise<UploadValidationResult> {
  if (input.source.size < 1) throw malformed("EMPTY_FILE")
  if (input.source.size > input.policy.maxBytes) {
    throw new UploadValidationError(
      "SIZE_LIMIT",
      "The upload exceeds the configured size limit.",
      UploadFailureCategory.SIZE_LIMIT,
    )
  }

  const format = detectFormat(await readMagic(input.source.path))
  if (!format || !input.policy.formats[format]) {
    throw new UploadValidationError(
      "TYPE_MISMATCH",
      "The uploaded file type is not permitted.",
      UploadFailureCategory.TYPE_MISMATCH,
    )
  }

  const extension = normalizeExtension(input.extension)
  const formatPolicy = input.policy.formats[format]
  if (!formatPolicy.extensions.includes(extension) || !formatPolicy.mimeTypes.includes(input.declaredMimeType.toLowerCase())) {
    throw new UploadValidationError(
      "TYPE_MISMATCH",
      "The file extension, declared type, and detected content do not agree.",
      UploadFailureCategory.TYPE_MISMATCH,
    )
  }

  const structural = await VALIDATORS[format].validate(input.source, input.policy)
  return {
    format,
    detectedMimeType: FORMAT_MIME[format],
    validatedExtension: extension,
    actualSize: input.source.size,
    structural,
  }
}
