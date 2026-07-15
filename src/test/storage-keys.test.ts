import { describe, expect, it } from "vitest"
import { InvalidStorageKeyError, StoragePathTraversalError } from "@/lib/storage/errors"
import { storageKeys, validateStorageKey } from "@/lib/storage/keys"

const ids = {
  organizationId: "cm0000000000000000000001",
  clientId: "cm0000000000000000000002",
  packetId: "cm0000000000000000000003",
  packetDocumentId: "cm0000000000000000000004",
  documentTemplateId: "cm0000000000000000000005",
  pdfVersionId: "cm0000000000000000000006",
  supportingDocumentId: "cm0000000000000000000007",
  requestId: "cm0000000000000000000008",
  signatureRequestId: "cm0000000000000000000009",
  uploadAttemptId: "cm0000000000000000000010",
  artifactId: "12345678-1234-4234-8234-123456789012",
}

describe("tenant-safe storage keys", () => {
  it("builds every approved opaque pattern exactly", () => {
    expect(storageKeys.templateSource(ids)).toBe(`organizations/${ids.organizationId}/templates/${ids.documentTemplateId}/source/${ids.artifactId}.pdf`)
    expect(storageKeys.packetDocumentVersion(ids)).toBe(`organizations/${ids.organizationId}/clients/${ids.clientId}/packets/${ids.packetId}/documents/${ids.packetDocumentId}/versions/${ids.pdfVersionId}.pdf`)
    expect(storageKeys.clientSupportingDocument(ids)).toBe(`organizations/${ids.organizationId}/clients/${ids.clientId}/supporting/${ids.supportingDocumentId}/${ids.artifactId}`)
    expect(storageKeys.organizationSupportingDocument(ids)).toBe(`organizations/${ids.organizationId}/supporting/${ids.supportingDocumentId}/${ids.artifactId}`)
    expect(storageKeys.portalRequestUpload(ids)).toBe(`organizations/${ids.organizationId}/clients/${ids.clientId}/portal-requests/${ids.requestId}/uploads/${ids.supportingDocumentId}/${ids.artifactId}`)
    expect(storageKeys.finalizedPdf(ids)).toBe(`organizations/${ids.organizationId}/clients/${ids.clientId}/packets/${ids.packetId}/documents/${ids.packetDocumentId}/final/${ids.artifactId}.pdf`)
    expect(storageKeys.signatureArtifact(ids)).toBe(`organizations/${ids.organizationId}/clients/${ids.clientId}/packets/${ids.packetId}/documents/${ids.packetDocumentId}/signatures/${ids.signatureRequestId}/${ids.artifactId}`)
    expect(storageKeys.quarantine(ids)).toBe(`organizations/${ids.organizationId}/uploads/${ids.uploadAttemptId}/${ids.artifactId}`)
  })

  it("keeps quarantine separate from durable resource keys", () => {
    expect(storageKeys.quarantine(ids)).not.toContain("/templates/")
    expect(storageKeys.quarantine(ids)).not.toContain("/supporting/")
    expect(storageKeys.quarantine(ids)).not.toContain("/packets/")
  })

  it("produces distinct keys for different tenants", () => {
    const other = { ...ids, organizationId: "cm0000000000000000000099" }
    expect(storageKeys.templateSource(other)).not.toBe(storageKeys.templateSource(ids))
  })

  it.each(["", " ", "../client", "client/id", "client\\id"])("rejects an empty or path-bearing id: %j", (clientId) => {
    expect(() => storageKeys.clientSupportingDocument({ ...ids, clientId })).toThrow()
  })

  it.each(["Alice Johnson", "alice@example.com", "123-45-6789", "1990-01-01", "MN-245D-001", "intake.pdf", "Annual Review"])("rejects PHI-like or display input: %s", (artifactId) => {
    expect(() => storageKeys.templateSource({ ...ids, artifactId })).toThrow(InvalidStorageKeyError)
  })

  it("never accepts an original filename as a generated-key component", () => {
    const key = storageKeys.templateSource(ids)
    expect(key).not.toContain("medical-record.pdf")
    expect(Object.keys(ids)).not.toContain("originalFileName")
  })

  it("rejects unsafe general storage keys", () => {
    expect(() => validateStorageKey("../escape.pdf")).toThrow(StoragePathTraversalError)
    expect(() => validateStorageKey("/absolute.pdf")).toThrow(StoragePathTraversalError)
    expect(() => validateStorageKey("safe//bad.pdf")).toThrow(StoragePathTraversalError)
  })
})
