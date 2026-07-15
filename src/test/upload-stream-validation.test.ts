// @vitest-environment node

import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { Readable } from "node:stream"
import { zipSync, strToU8 } from "fflate"
import sharp from "sharp"
import { afterEach, describe, expect, it } from "vitest"
import { PORTAL_UPLOAD_PROFILE, STAFF_SUPPORTING_PROFILE, TEMPLATE_PDF_PROFILE } from "@/lib/uploads/profiles"
import { withUploadSpool } from "@/lib/uploads/stream"
import { MAX_UPLOAD_BYTES } from "@/lib/uploads/types"
import { validateUpload } from "@/lib/uploads/validation"

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), "upload-foundation-test-"))
  roots.push(value)
  return value
}

describe("streaming checksum and spool lifecycle", () => {
  it("counts streamed bytes, hashes once, and removes the spool after success", async () => {
    const temporaryRoot = await root()
    const result = await withUploadSpool(
      { stream: Readable.from([Buffer.from("stream"), Buffer.from("ed")]), maxBytes: 100, declaredSize: 8, temporaryRoot },
      async (spool) => {
        expect(spool.size).toBe(8)
        expect(spool.checksumSha256).toBe("97a78c00831554f7cc9745e8f6732edcfb571cf548a8d12b48a6e3fc31e5e3e6")
        return fs.readFile(spool.path, "utf8")
      },
    )
    expect(result).toBe("streamed")
    expect(await fs.readdir(temporaryRoot)).toEqual([])
  })

  it("enforces actual bytes and declared-versus-received size and always cleans up", async () => {
    const temporaryRoot = await root()
    await expect(
      withUploadSpool({ stream: Readable.from(Buffer.alloc(11)), maxBytes: 10, temporaryRoot }, async () => undefined),
    ).rejects.toMatchObject({ code: "SIZE_LIMIT" })
    await expect(
      withUploadSpool({ stream: Readable.from(Buffer.alloc(9)), maxBytes: 10, declaredSize: 8, temporaryRoot }, async () => undefined),
    ).rejects.toMatchObject({ code: "SIZE_MISMATCH" })
    expect(await fs.readdir(temporaryRoot)).toEqual([])
  })
})

describe("typed upload validation profiles", () => {
  it("uses 25 MB limits and rejects HEIC from the new portal profile", () => {
    expect(TEMPLATE_PDF_PROFILE.maxBytes).toBe(MAX_UPLOAD_BYTES)
    expect(STAFF_SUPPORTING_PROFILE.maxBytes).toBe(MAX_UPLOAD_BYTES)
    expect(PORTAL_UPLOAD_PROFILE.maxBytes).toBe(MAX_UPLOAD_BYTES)
    expect(Object.keys(STAFF_SUPPORTING_PROFILE.formats).sort()).toEqual(["docx", "jpeg", "pdf", "png"])
    expect(Object.keys(PORTAL_UPLOAD_PROFILE.formats)).not.toContain("heic")
  })

  it("decodes and bounds PNG structure without transforming it", async () => {
    const directory = await root()
    const file = path.join(directory, "image.png")
    await sharp({ create: { width: 8, height: 6, channels: 3, background: "white" } }).png().toFile(file)
    const result = await validateUpload({
      source: { path: file, size: (await fs.stat(file)).size, openStream: () => createReadStream(file) },
      extension: ".png",
      declaredMimeType: "image/png",
      policy: STAFF_SUPPORTING_PROFILE,
    })
    expect(result).toMatchObject({ format: "png", detectedMimeType: "image/png", structural: { width: 8, height: 6, frameCount: 1 } })
    await expect(
      validateUpload({
        source: { path: file, size: (await fs.stat(file)).size, openStream: () => createReadStream(file) },
        extension: ".png",
        declaredMimeType: "image/png",
        policy: { ...STAFF_SUPPORTING_PROFILE, image: { ...STAFF_SUPPORTING_PROFILE.image, maxWidth: 4 } },
      }),
    ).rejects.toMatchObject({ safeDiagnostic: "IMAGE_RESOURCE_LIMIT" })
  })

  it("rejects truncated images and extension/MIME disagreement with bounded errors", async () => {
    const directory = await root()
    const file = path.join(directory, "broken.png")
    await fs.writeFile(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    const source = { path: file, size: 8, openStream: () => createReadStream(file) }
    await expect(validateUpload({ source, extension: ".png", declaredMimeType: "image/png", policy: STAFF_SUPPORTING_PROFILE })).rejects.toMatchObject({
      code: "MALFORMED_CONTENT",
      safeDiagnostic: "IMAGE_DECODE_FAILED",
    })
    await expect(validateUpload({ source, extension: ".jpg", declaredMimeType: "image/jpeg", policy: STAFF_SUPPORTING_PROFILE })).rejects.toMatchObject({
      code: "TYPE_MISMATCH",
    })
  })

  it("validates required DOCX package entries and rejects external relationships", async () => {
    const directory = await root()
    const validFile = path.join(directory, "valid.docx")
    const required = {
      "[Content_Types].xml": strToU8("<Types />"),
      "_rels/.rels": strToU8("<Relationships />"),
      "word/document.xml": strToU8("<w:document />"),
    }
    await fs.writeFile(validFile, Buffer.from(zipSync(required)))
    const validSource = { path: validFile, size: (await fs.stat(validFile)).size, openStream: () => createReadStream(validFile) }
    await expect(
      validateUpload({
        source: validSource,
        extension: ".docx",
        declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        policy: STAFF_SUPPORTING_PROFILE,
      }),
    ).resolves.toMatchObject({ format: "docx", structural: { archiveEntryCount: 3 } })

    const externalFile = path.join(directory, "external.docx")
    await fs.writeFile(
      externalFile,
      Buffer.from(zipSync({ ...required, "word/_rels/document.xml.rels": strToU8('<Relationship TargetMode="External" />') })),
    )
    const externalSource = { path: externalFile, size: (await fs.stat(externalFile)).size, openStream: () => createReadStream(externalFile) }
    await expect(
      validateUpload({
        source: externalSource,
        extension: ".docx",
        declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        policy: STAFF_SUPPORTING_PROFILE,
      }),
    ).rejects.toMatchObject({ safeDiagnostic: "DOCX_EXTERNAL_RELATIONSHIP" })

    const traversalFile = path.join(directory, "traversal.docx")
    await fs.writeFile(traversalFile, Buffer.from(zipSync({ ...required, "../payload.exe": strToU8("not executable") })))
    const traversalSource = { path: traversalFile, size: (await fs.stat(traversalFile)).size, openStream: () => createReadStream(traversalFile) }
    await expect(
      validateUpload({
        source: traversalSource,
        extension: ".docx",
        declaredMimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        policy: STAFF_SUPPORTING_PROFILE,
      }),
    ).rejects.toMatchObject({ safeDiagnostic: "DOCX_TRAVERSAL_ENTRY" })
  })

  it("parses a synthetic fixture PDF and enforces the PDF-only profile", async () => {
    const file = path.join(process.cwd(), "prisma", "fixtures", "templates", "consent-for-services.pdf")
    const source = { path: file, size: (await fs.stat(file)).size, openStream: () => createReadStream(file) }
    await expect(
      validateUpload({ source, extension: ".pdf", declaredMimeType: "application/pdf", policy: TEMPLATE_PDF_PROFILE }),
    ).resolves.toMatchObject({ format: "pdf", detectedMimeType: "application/pdf", structural: { pageCount: expect.any(Number) } })
  })

  it("rejects PDF active-content and encryption markers with bounded categories", async () => {
    const directory = await root()
    const fixture = await fs.readFile(path.join(process.cwd(), "prisma", "fixtures", "templates", "consent-for-services.pdf"))
    for (const [name, token, expected] of [
      ["active.pdf", "/Launch", { code: "ACTIVE_CONTENT", safeDiagnostic: "PDF_LAUNCH_ACTION" }],
      ["encrypted.pdf", "/Encrypt", { code: "ENCRYPTED_PDF", safeDiagnostic: "PDF_ENCRYPTED" }],
    ] as const) {
      const file = path.join(directory, name)
      await fs.writeFile(file, Buffer.concat([fixture, Buffer.from(`\n${token}\n`)]))
      const source = { path: file, size: (await fs.stat(file)).size, openStream: () => createReadStream(file) }
      await expect(
        validateUpload({ source, extension: ".pdf", declaredMimeType: "application/pdf", policy: TEMPLATE_PDF_PROFILE }),
      ).rejects.toMatchObject(expected)
    }
  })
})
