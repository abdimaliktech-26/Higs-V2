import { beforeEach, describe, expect, it, vi } from "vitest"

const getLiveStaffAuthorizationContext = vi.fn()
const requireActiveOrganizationMembership = vi.fn()
const requireClientAccess = vi.fn()
const requireDocumentAccess = vi.fn()
const requireOrganizationRole = vi.fn()
const requirePacketAccess = vi.fn()
const packetDocumentFindMany = vi.fn()
const packetDocumentFindUnique = vi.fn()
const packetDocumentGroupBy = vi.fn()
const packetDocumentCount = vi.fn()
const supportingDocumentFindMany = vi.fn()
const supportingDocumentFindUnique = vi.fn()
const supportingDocumentCreate = vi.fn()
const documentTemplateFindMany = vi.fn()
const documentTemplateFindUnique = vi.fn()
const documentTemplateCount = vi.fn()
const packetFindUnique = vi.fn()
const auditEventFindMany = vi.fn()
const createAuditEvent = vi.fn()
const storeFile = vi.fn()
const signStaffFileUrl = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  CLIENT_READ_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"],
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  getLiveStaffAuthorizationContext: (...args: unknown[]) => getLiveStaffAuthorizationContext(...args),
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
  requireClientAccess: (...args: unknown[]) => requireClientAccess(...args),
  requireDocumentAccess: (...args: unknown[]) => requireDocumentAccess(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    packetDocument: {
      findMany: (...args: unknown[]) => packetDocumentFindMany(...args),
      findUnique: (...args: unknown[]) => packetDocumentFindUnique(...args),
      groupBy: (...args: unknown[]) => packetDocumentGroupBy(...args),
      count: (...args: unknown[]) => packetDocumentCount(...args),
    },
    supportingDocument: {
      findMany: (...args: unknown[]) => supportingDocumentFindMany(...args),
      findUnique: (...args: unknown[]) => supportingDocumentFindUnique(...args),
      create: (...args: unknown[]) => supportingDocumentCreate(...args),
      count: vi.fn(),
    },
    documentTemplate: {
      findMany: (...args: unknown[]) => documentTemplateFindMany(...args),
      findUnique: (...args: unknown[]) => documentTemplateFindUnique(...args),
      count: (...args: unknown[]) => documentTemplateCount(...args),
    },
    packet: { findUnique: (...args: unknown[]) => packetFindUnique(...args) },
    auditEvent: { findMany: (...args: unknown[]) => auditEventFindMany(...args) },
  },
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("@/lib/storage", () => ({
  storeFile: (...args: unknown[]) => storeFile(...args),
  signStaffFileUrl: (...args: unknown[]) => signStaffFileUrl(...args),
}))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const USER_ID = "case-manager-1"
const CLIENT_ID = "client-1"
const PACKET_ID = "packet-1"

beforeEach(() => {
  vi.clearAllMocks()
  const authorization = { userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" }
  getLiveStaffAuthorizationContext.mockResolvedValue({ ...authorization, selectedOrganizationId: ORG_ID })
  requireActiveOrganizationMembership.mockResolvedValue(authorization)
  requireClientAccess.mockResolvedValue({ ...authorization, clientId: CLIENT_ID })
  requireDocumentAccess.mockResolvedValue({ ...authorization, clientId: CLIENT_ID, packetId: PACKET_ID })
  requireOrganizationRole.mockResolvedValue(authorization)
  requirePacketAccess.mockResolvedValue({ ...authorization, clientId: CLIENT_ID, packetId: PACKET_ID })
  packetDocumentFindMany.mockResolvedValue([])
  supportingDocumentFindMany.mockResolvedValue([])
  documentTemplateFindMany.mockResolvedValue([])
  supportingDocumentCreate.mockResolvedValue({ id: "supporting-1" })
  storeFile.mockResolvedValue({ url: "staff-file://key", key: "key", size: 3 })
  createAuditEvent.mockResolvedValue(undefined)
})

describe("document library live authorization", () => {
  it("composes organization, status, client, and current-assignment filters for scoped roles", async () => {
    const { getLibraryDocuments } = await import("@/lib/actions/library")
    await getLibraryDocuments(ORG_ID, { tab: "active", clientId: CLIENT_ID, status: "in_progress" })

    expect(requireOrganizationRole).toHaveBeenCalledWith(ORG_ID, expect.any(Array), "list document library")
    const packet = packetDocumentFindMany.mock.calls[0][0].where.packet
    expect(packet.organizationId).toBe(ORG_ID)
    expect(packet.clientId).toBe(CLIENT_ID)
    expect(packet.status).toBe("in_progress")
    expect(packet.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(packet.client.assignments.some.AND).toHaveLength(2)
    expect(supportingDocumentFindMany.mock.calls[0][0].where.client.assignments.some.staffUserId).toBe(USER_ID)
  })

  it("does not assignment-filter organization-wide roles", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "admin-1", organizationId: ORG_ID, role: "ORG_ADMIN" })
    const { getLibraryDocuments } = await import("@/lib/actions/library")
    await getLibraryDocuments(ORG_ID, { tab: "all" })

    expect(packetDocumentFindMany.mock.calls[0][0].where.packet.client).toBeUndefined()
    expect(supportingDocumentFindMany.mock.calls[0][0].where.client).toBeUndefined()
  })

  it("authorizes a client-bound supporting upload against the owning client and returns the live actor", async () => {
    const { authorizeStaffSupportingUpload } = await import("@/lib/uploads/staff-supporting-authorization")
    const authorized = await authorizeStaffSupportingUpload({ clientId: CLIENT_ID })

    expect(requireClientAccess).toHaveBeenCalledWith(CLIENT_ID, "manage", "upload supporting document")
    expect(authorized).toEqual({ userId: USER_ID, organizationId: ORG_ID, clientId: CLIENT_ID, packetId: undefined })
  })

  it("authorizes a packet-bound supporting upload against the owning packet and rejects an organization mismatch", async () => {
    packetFindUnique.mockResolvedValue({ clientId: CLIENT_ID, organizationId: ORG_ID })
    const { authorizeStaffSupportingUpload } = await import("@/lib/uploads/staff-supporting-authorization")
    const authorized = await authorizeStaffSupportingUpload({ packetId: PACKET_ID })

    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "manage", "upload supporting document")
    expect(authorized.clientId).toBe(CLIENT_ID)

    packetFindUnique.mockResolvedValue({ clientId: CLIENT_ID, organizationId: "other-org" })
    await expect(authorizeStaffSupportingUpload({ packetId: PACKET_ID })).rejects.toThrow("Packet not found")
  })

  it("requires organization-wide authority for an unbound supporting upload and gates non-manager roles", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "admin-1", organizationId: ORG_ID, role: "ORG_ADMIN" })
    const { authorizeStaffSupportingUpload } = await import("@/lib/uploads/staff-supporting-authorization")
    const authorized = await authorizeStaffSupportingUpload({})

    expect(requireOrganizationRole).toHaveBeenCalledWith(
      ORG_ID, ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"], "upload unbound supporting document",
    )
    expect(authorized.userId).toBe("admin-1")

    requireClientAccess.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "DSP" })
    await expect(authorizeStaffSupportingUpload({ clientId: CLIENT_ID })).rejects.toThrow("Insufficient permissions")
  })

  it("authorizes packet document detail before loading its PHI-bearing detail", async () => {
    packetDocumentFindUnique.mockResolvedValue({ id: "document-1", documentTemplate: { fileKey: null } })
    const { getDocumentDetail } = await import("@/lib/actions/library")
    await getDocumentDetail("packet", "document-1")

    expect(requireDocumentAccess).toHaveBeenCalledWith("document-1", "read", "view library packet document")
    expect(requireDocumentAccess.mock.invocationCallOrder[0]).toBeLessThan(packetDocumentFindUnique.mock.invocationCallOrder[0])
  })

  it("rejects a supporting-document organization-chain mismatch before loading detail", async () => {
    supportingDocumentFindUnique.mockResolvedValueOnce({ organizationId: "org-other", clientId: CLIENT_ID, packetId: null })
    const { getDocumentDetail } = await import("@/lib/actions/library")
    const result = await getDocumentDetail("supporting", "supporting-1")

    expect(requireClientAccess).toHaveBeenCalledWith(CLIENT_ID, "read", "view library supporting document")
    expect(result).toBeNull()
    expect(supportingDocumentFindUnique).toHaveBeenCalledTimes(1)
  })
})
