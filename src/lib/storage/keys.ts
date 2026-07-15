import { InvalidStorageKeyError, StoragePathTraversalError } from "./errors"

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const CUID = /^c[a-z0-9]{20,31}$/

function opaqueId(value: string, label: string): string {
  if (!value || !value.trim()) throw new InvalidStorageKeyError(`${label} must not be empty`)
  if (value.includes("/") || value.includes("\\") || value === "." || value === "..") {
    throw new StoragePathTraversalError()
  }
  // Storage keys accept only repository-generated CUIDs or UUIDs. This
  // deliberately excludes names, emails, filenames, SSNs, dates, titles,
  // Medicaid identifiers, and caller-provided path fragments.
  if (!UUID.test(value) && !CUID.test(value)) {
    throw new InvalidStorageKeyError(`${label} must be an opaque resource identifier`)
  }
  return value
}

export function validateStorageKey(key: string): string {
  if (!key || !key.trim()) throw new InvalidStorageKeyError()
  if (key.startsWith("/") || key.includes("\\") || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new StoragePathTraversalError()
  }
  return key
}

export const storageKeys = {
  templateSource(input: { organizationId: string; documentTemplateId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/templates/${opaqueId(input.documentTemplateId, "documentTemplateId")}/source/${opaqueId(input.artifactId, "artifactId")}.pdf`
  },

  packetDocumentVersion(input: { organizationId: string; clientId: string; packetId: string; packetDocumentId: string; pdfVersionId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/clients/${opaqueId(input.clientId, "clientId")}/packets/${opaqueId(input.packetId, "packetId")}/documents/${opaqueId(input.packetDocumentId, "packetDocumentId")}/versions/${opaqueId(input.pdfVersionId, "pdfVersionId")}.pdf`
  },

  clientSupportingDocument(input: { organizationId: string; clientId: string; supportingDocumentId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/clients/${opaqueId(input.clientId, "clientId")}/supporting/${opaqueId(input.supportingDocumentId, "supportingDocumentId")}/${opaqueId(input.artifactId, "artifactId")}`
  },

  organizationSupportingDocument(input: { organizationId: string; supportingDocumentId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/supporting/${opaqueId(input.supportingDocumentId, "supportingDocumentId")}/${opaqueId(input.artifactId, "artifactId")}`
  },

  portalRequestUpload(input: { organizationId: string; clientId: string; requestId: string; supportingDocumentId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/clients/${opaqueId(input.clientId, "clientId")}/portal-requests/${opaqueId(input.requestId, "requestId")}/uploads/${opaqueId(input.supportingDocumentId, "supportingDocumentId")}/${opaqueId(input.artifactId, "artifactId")}`
  },

  finalizedPdf(input: { organizationId: string; clientId: string; packetId: string; packetDocumentId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/clients/${opaqueId(input.clientId, "clientId")}/packets/${opaqueId(input.packetId, "packetId")}/documents/${opaqueId(input.packetDocumentId, "packetDocumentId")}/final/${opaqueId(input.artifactId, "artifactId")}.pdf`
  },

  signatureArtifact(input: { organizationId: string; clientId: string; packetId: string; packetDocumentId: string; signatureRequestId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/clients/${opaqueId(input.clientId, "clientId")}/packets/${opaqueId(input.packetId, "packetId")}/documents/${opaqueId(input.packetDocumentId, "packetDocumentId")}/signatures/${opaqueId(input.signatureRequestId, "signatureRequestId")}/${opaqueId(input.artifactId, "artifactId")}`
  },

  quarantine(input: { organizationId: string; uploadAttemptId: string; artifactId: string }): string {
    return `organizations/${opaqueId(input.organizationId, "organizationId")}/uploads/${opaqueId(input.uploadAttemptId, "uploadAttemptId")}/${opaqueId(input.artifactId, "artifactId")}`
  },
}
