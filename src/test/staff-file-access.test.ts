import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const documentTemplateFindUnique = vi.fn()
const packetDocumentFindUnique = vi.fn()
const pdfVersionFindUnique = vi.fn()
const supportingDocumentFindUnique = vi.fn()
const requireActiveOrganizationMembership = vi.fn()
const requireDocumentAccess = vi.fn()
const requirePacketAccess = vi.fn()
const requireClientAccess = vi.fn()
const requireOrganizationRole = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    documentTemplate: { findUnique: (...args: unknown[]) => documentTemplateFindUnique(...args) },
    packetDocument: { findUnique: (...args: unknown[]) => packetDocumentFindUnique(...args) },
    pdfVersion: { findUnique: (...args: unknown[]) => pdfVersionFindUnique(...args) },
    supportingDocument: { findUnique: (...args: unknown[]) => supportingDocumentFindUnique(...args) },
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
  requireDocumentAccess: (...args: unknown[]) => requireDocumentAccess(...args),
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
  requireClientAccess: (...args: unknown[]) => requireClientAccess(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
}))

const ORG_ID = "org-1"
const ACTOR_ID = "staff-1"
const CLIENT_ID = "client-1"
const authorization = { userId: ACTOR_ID, organizationId: ORG_ID, role: "ORG_ADMIN" }

beforeEach(() => {
  vi.clearAllMocks()
  documentTemplateFindUnique.mockResolvedValue({ id: "template-1", organizationId: ORG_ID, fileKey: "templates/file.pdf" })
  packetDocumentFindUnique.mockResolvedValue({
    id: "document-1", documentTemplate: { fileKey: "templates/file.pdf" }, packet: { organizationId: ORG_ID },
  })
  pdfVersionFindUnique.mockResolvedValue({ id: "version-1", packetDocumentId: "document-1", fileKey: "documents/v1.pdf" })
  supportingDocumentFindUnique.mockResolvedValue({
    id: "supporting-1", organizationId: ORG_ID, clientId: CLIENT_ID, packetId: null,
    fileKey: "supporting/file.pdf", client: { organizationId: ORG_ID }, packet: null,
  })
  requireActiveOrganizationMembership.mockResolvedValue(authorization)
  requireDocumentAccess.mockResolvedValue(authorization)
  requirePacketAccess.mockResolvedValue(authorization)
  requireClientAccess.mockResolvedValue(authorization)
  requireOrganizationRole.mockResolvedValue(authorization)
})

describe("requireStaffFileAccess", () => {
  it("authorizes a template through live membership in its database organization", async () => {
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    const result = await requireStaffFileAccess("document_template", "template-1")
    expect(requireActiveOrganizationMembership).toHaveBeenCalledWith(ORG_ID, "download document template file")
    expect(result).toMatchObject({ actorId: ACTOR_ID, organizationId: ORG_ID, fileKey: "templates/file.pdf" })
  })

  it("authorizes a packet document through its live document access boundary", async () => {
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    const result = await requireStaffFileAccess("packet_document", "document-1")
    expect(requireDocumentAccess).toHaveBeenCalledWith("document-1", "read", "download packet document file")
    expect(result.resourceType).toBe("packet_document")
  })

  it("authorizes a PDF version through its parent packet document", async () => {
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    const result = await requireStaffFileAccess("pdf_version", "version-1")
    expect(requireDocumentAccess).toHaveBeenCalledWith("document-1", "read", "download packet document version")
    expect(result.fileKey).toBe("documents/v1.pdf")
  })

  it("authorizes a client-linked supporting document through live client assignment", async () => {
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await requireStaffFileAccess("supporting_document", "supporting-1")
    expect(requireClientAccess).toHaveBeenCalledWith(CLIENT_ID, "read", "download supporting document attached to client")
  })

  it("uses the packet as authoritative for a packet-linked supporting document", async () => {
    supportingDocumentFindUnique.mockResolvedValue({
      id: "supporting-1", organizationId: ORG_ID, clientId: CLIENT_ID, packetId: "packet-1",
      fileKey: "supporting/file.pdf", client: { organizationId: ORG_ID },
      packet: { organizationId: ORG_ID, clientId: CLIENT_ID },
    })
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await requireStaffFileAccess("supporting_document", "supporting-1")
    expect(requirePacketAccess).toHaveBeenCalledWith("packet-1", "read", "download supporting document attached to packet")
    expect(requireClientAccess).not.toHaveBeenCalled()
  })

  it("limits organization-level supporting documents to organization-wide roles", async () => {
    supportingDocumentFindUnique.mockResolvedValue({
      id: "supporting-1", organizationId: ORG_ID, clientId: null, packetId: null,
      fileKey: "supporting/file.pdf", client: null, packet: null,
    })
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await requireStaffFileAccess("supporting_document", "supporting-1")
    expect(requireOrganizationRole).toHaveBeenCalledWith(
      ORG_ID,
      ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
      "download organization-level supporting document",
    )
  })

  it.each(["document_template", "packet_document", "pdf_version", "supporting_document"] as const)("rejects a missing %s resource", async (resourceType) => {
    documentTemplateFindUnique.mockResolvedValue(null)
    packetDocumentFindUnique.mockResolvedValue(null)
    pdfVersionFindUnique.mockResolvedValue(null)
    supportingDocumentFindUnique.mockResolvedValue(null)
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await expect(requireStaffFileAccess(resourceType, "missing")).rejects.toThrow("File not found")
  })

  it("rejects a client-to-supporting-document organization mismatch", async () => {
    supportingDocumentFindUnique.mockResolvedValue({
      id: "supporting-1", organizationId: ORG_ID, clientId: CLIENT_ID, packetId: null,
      fileKey: "supporting/file.pdf", client: { organizationId: "org-other" }, packet: null,
    })
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await expect(requireStaffFileAccess("supporting_document", "supporting-1")).rejects.toThrow("File not found")
    expect(requireClientAccess).not.toHaveBeenCalled()
  })

  it("rejects a packet-to-supporting-document organization mismatch", async () => {
    supportingDocumentFindUnique.mockResolvedValue({
      id: "supporting-1", organizationId: ORG_ID, clientId: null, packetId: "packet-1",
      fileKey: "supporting/file.pdf", client: null, packet: { organizationId: "org-other", clientId: CLIENT_ID },
    })
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await expect(requireStaffFileAccess("supporting_document", "supporting-1")).rejects.toThrow("File not found")
    expect(requirePacketAccess).not.toHaveBeenCalled()
  })

  it("rejects inconsistent client and packet ownership", async () => {
    supportingDocumentFindUnique.mockResolvedValue({
      id: "supporting-1", organizationId: ORG_ID, clientId: CLIENT_ID, packetId: "packet-1",
      fileKey: "supporting/file.pdf", client: { organizationId: ORG_ID },
      packet: { organizationId: ORG_ID, clientId: "client-other" },
    })
    const { requireStaffFileAccess } = await import("@/lib/staff-file-access")
    await expect(requireStaffFileAccess("supporting_document", "supporting-1")).rejects.toThrow("File not found")
  })
})
