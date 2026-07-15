import { UploadKind } from "@prisma/client"
import { MAX_UPLOAD_BYTES, type UploadValidationPolicy } from "./types"

const PDF = { extensions: [".pdf"], mimeTypes: ["application/pdf"] } as const
const JPEG = { extensions: [".jpg", ".jpeg"], mimeTypes: ["image/jpeg"] } as const
const PNG = { extensions: [".png"], mimeTypes: ["image/png"] } as const
const DOCX = {
  extensions: [".docx"],
  mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
} as const

const BASE_LIMITS = {
  image: {
    maxWidth: 10_000,
    maxHeight: 10_000,
    maxPixels: 40_000_000,
    maxFrames: 1,
    maxDecompressedBytes: 160 * 1024 * 1024,
  },
  pdf: {
    maxPages: 1_000,
    rejectEncrypted: true,
    rejectActiveContent: true,
    rejectEmbeddedFiles: true,
    rejectXfa: true,
  },
  docx: {
    maxEntries: 1_000,
    maxCompressedBytes: MAX_UPLOAD_BYTES,
    maxDecompressedBytes: 100 * 1024 * 1024,
    maxCompressionRatio: 100,
    rejectMacros: true,
    rejectExecutables: true,
    rejectExternalRelationships: true,
  },
} as const

export const TEMPLATE_PDF_PROFILE: UploadValidationPolicy = {
  kind: UploadKind.TEMPLATE,
  maxBytes: MAX_UPLOAD_BYTES,
  formats: { pdf: PDF },
  ...BASE_LIMITS,
}

export const TEMPLATE_VERSION_PDF_PROFILE: UploadValidationPolicy = {
  ...TEMPLATE_PDF_PROFILE,
  kind: UploadKind.TEMPLATE_VERSION,
}

export const STAFF_SUPPORTING_PROFILE: UploadValidationPolicy = {
  kind: UploadKind.STAFF_SUPPORTING,
  maxBytes: MAX_UPLOAD_BYTES,
  formats: { pdf: PDF, jpeg: JPEG, png: PNG, docx: DOCX },
  ...BASE_LIMITS,
}

export const PORTAL_UPLOAD_PROFILE: UploadValidationPolicy = {
  kind: UploadKind.PORTAL_REQUEST,
  maxBytes: MAX_UPLOAD_BYTES,
  formats: { pdf: PDF, jpeg: JPEG, png: PNG, docx: DOCX },
  ...BASE_LIMITS,
}

export function getUploadValidationProfile(kind: UploadKind): UploadValidationPolicy {
  switch (kind) {
    case UploadKind.TEMPLATE:
      return TEMPLATE_PDF_PROFILE
    case UploadKind.TEMPLATE_VERSION:
      return TEMPLATE_VERSION_PDF_PROFILE
    case UploadKind.STAFF_SUPPORTING:
      return STAFF_SUPPORTING_PROFILE
    case UploadKind.PORTAL_REQUEST:
      return PORTAL_UPLOAD_PROFILE
  }
}
