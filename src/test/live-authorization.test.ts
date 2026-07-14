import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const authMock = vi.fn()
const userFindUnique = vi.fn()
const organizationMemberFindUnique = vi.fn()
const staffAssignmentFindFirst = vi.fn()
const clientFindUnique = vi.fn()
const packetFindUnique = vi.fn()
const packetDocumentFindUnique = vi.fn()
const createAuditEventMock = vi.fn()

vi.mock("@/lib/auth", () => ({ auth: (...args: unknown[]) => authMock(...args) }))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEventMock(...args) }))
vi.mock("@/lib/db", () => ({
  prisma: {
    user: { findUnique: (...args: unknown[]) => userFindUnique(...args) },
    organizationMember: { findUnique: (...args: unknown[]) => organizationMemberFindUnique(...args) },
    staffAssignment: { findFirst: (...args: unknown[]) => staffAssignmentFindFirst(...args) },
    client: { findUnique: (...args: unknown[]) => clientFindUnique(...args) },
    packet: { findUnique: (...args: unknown[]) => packetFindUnique(...args) },
    packetDocument: { findUnique: (...args: unknown[]) => packetDocumentFindUnique(...args) },
  },
}))

const USER_ID = "user-1"
const ORG_A = "org-a"
const ORG_B = "org-b"
const CLIENT_ID = "client-1"

function session(overrides: Record<string, unknown> = {}) {
  return {
    user: {
      id: USER_ID,
      activeOrganizationId: ORG_A,
      // Deliberately stale claims: live authorization must ignore both.
      isSuperAdmin: true,
      memberships: [{ organizationId: ORG_A, role: "SUPER_ADMIN", status: "ACTIVE" }],
      ...overrides,
    },
  }
}

function membership(role = "CASE_MANAGER", status = "ACTIVE") {
  return { id: "membership-1", role, status }
}

beforeEach(() => {
  vi.clearAllMocks()
  authMock.mockResolvedValue(session())
  userFindUnique.mockResolvedValue({ id: USER_ID, email: "staff@example.com", name: "Staff", isSuperAdmin: false })
  organizationMemberFindUnique.mockResolvedValue(membership())
  staffAssignmentFindFirst.mockResolvedValue({ id: "assignment-1" })
  clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_A })
  packetFindUnique.mockResolvedValue({ id: "packet-1", organizationId: ORG_A, clientId: CLIENT_ID, client: { organizationId: ORG_A } })
  packetDocumentFindUnique.mockResolvedValue({
    id: "document-1",
    packet: { id: "packet-1", organizationId: ORG_A, clientId: CLIENT_ID, client: { organizationId: ORG_A } },
  })
  createAuditEventMock.mockResolvedValue(undefined)
})

describe("live staff identity and organization membership", () => {
  it("rejects a missing session identity", async () => {
    authMock.mockResolvedValue(null)
    const { getLiveStaffAuthorizationContext } = await import("@/lib/live-authorization")
    await expect(getLiveStaffAuthorizationContext()).rejects.toThrow("Access denied")
  })

  it("rejects a user deleted after the JWT was issued", async () => {
    userFindUnique.mockResolvedValue(null)
    const { getLiveStaffAuthorizationContext } = await import("@/lib/live-authorization")
    await expect(getLiveStaffAuthorizationContext()).rejects.toThrow("Access denied")
  })

  it("uses only the JWT identity and organization selection hint", async () => {
    const { getLiveStaffAuthorizationContext } = await import("@/lib/live-authorization")
    const result = await getLiveStaffAuthorizationContext()
    expect(result).toMatchObject({ userId: USER_ID, selectedOrganizationId: ORG_A, isGlobalSuperAdmin: false })
  })

  it.each(["INVITED", "DISABLED"])("rejects %s membership immediately", async (status) => {
    organizationMemberFindUnique.mockResolvedValue(membership("ORG_ADMIN", status))
    const { requireActiveOrganizationMembership } = await import("@/lib/live-authorization")
    await expect(requireActiveOrganizationMembership(ORG_A, "test access")).rejects.toThrow("Access denied")
  })

  it("rejects removed membership immediately", async () => {
    organizationMemberFindUnique.mockResolvedValue(null)
    const { requireActiveOrganizationMembership } = await import("@/lib/live-authorization")
    await expect(requireActiveOrganizationMembership(ORG_A, "test access")).rejects.toThrow("Access denied")
  })

  it("returns the current database role instead of the JWT role", async () => {
    organizationMemberFindUnique.mockResolvedValue(membership("NURSE"))
    const { requireActiveOrganizationMembership } = await import("@/lib/live-authorization")
    await expect(requireActiveOrganizationMembership(ORG_A, "test access")).resolves.toMatchObject({ role: "NURSE" })
  })

  it("observes a live role change on the next authorization", async () => {
    organizationMemberFindUnique
      .mockResolvedValueOnce(membership("CASE_MANAGER"))
      .mockResolvedValueOnce(membership("ORG_ADMIN"))
    const { requireActiveOrganizationMembership } = await import("@/lib/live-authorization")
    expect((await requireActiveOrganizationMembership(ORG_A, "first check")).role).toBe("CASE_MANAGER")
    expect((await requireActiveOrganizationMembership(ORG_A, "second check")).role).toBe("ORG_ADMIN")
  })

  it("resolves membership against the target organization, not the selected organization", async () => {
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_B })
    organizationMemberFindUnique.mockResolvedValue({ id: "membership-b", role: "ORG_ADMIN", status: "ACTIVE" })
    const { requireClientAccess } = await import("@/lib/live-authorization")
    const result = await requireClientAccess(CLIENT_ID, "read", "read target client")
    expect(result).toMatchObject({ organizationId: ORG_B, role: "ORG_ADMIN" })
    expect(organizationMemberFindUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { organizationId_userId: { organizationId: ORG_B, userId: USER_ID } },
    }))
  })
})

describe("assignment-scoped client access", () => {
  it.each(["CASE_MANAGER", "DSP", "NURSE"])("allows assigned %s read access", async (role) => {
    organizationMemberFindUnique.mockResolvedValue(membership(role))
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "read", "read client")).resolves.toMatchObject({ isAssignedToClient: true })
  })

  it.each(["CASE_MANAGER", "DSP", "NURSE"])("denies unassigned %s read access", async (role) => {
    organizationMemberFindUnique.mockResolvedValue(membership(role))
    staffAssignmentFindFirst.mockResolvedValue(null)
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "read", "read client")).rejects.toThrow("Access denied")
  })

  it.each(["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"])("allows %s organization-wide client access", async (role) => {
    organizationMemberFindUnique.mockResolvedValue(membership(role))
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "read", "read client")).resolves.toMatchObject({ role })
    expect(staffAssignmentFindFirst).not.toHaveBeenCalled()
  })

  it("allows an assigned Case Manager to create a packet", async () => {
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "packet:create", "create packet")).resolves.toMatchObject({ role: "CASE_MANAGER" })
  })

  it("allows an assigned Case Manager to update an assigned client", async () => {
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "manage", "update client")).resolves.toMatchObject({ role: "CASE_MANAGER" })
  })

  it("denies client updates to assigned DSP and Nurse roles", async () => {
    organizationMemberFindUnique.mockResolvedValue(membership("DSP"))
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "manage", "update client")).rejects.toThrow("Access denied")
  })

  it("denies client archival to an assigned Case Manager", async () => {
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "archive", "archive client")).rejects.toThrow("Access denied")
  })

  it("allows client archival to an organization-wide role", async () => {
    organizationMemberFindUnique.mockResolvedValue(membership("ORG_ADMIN"))
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "archive", "archive client")).resolves.toMatchObject({ role: "ORG_ADMIN" })
  })

  it.each(["DSP", "NURSE"])("denies packet creation to %s even when assigned", async (role) => {
    organizationMemberFindUnique.mockResolvedValue(membership(role))
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "packet:create", "create packet")).rejects.toThrow("Access denied")
  })

  it("does not carry an Organization A assignment into Organization B", async () => {
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_B })
    organizationMemberFindUnique.mockResolvedValue(membership("CASE_MANAGER"))
    staffAssignmentFindFirst.mockResolvedValue(null)
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "read", "read client")).rejects.toThrow("Access denied")
  })
})

describe("packet, document, role, and assignee policies", () => {
  it("derives packet access from the packet organization and client", async () => {
    const { requirePacketAccess } = await import("@/lib/live-authorization")
    await expect(requirePacketAccess("packet-1", "read", "read packet")).resolves.toMatchObject({ packetId: "packet-1", clientId: CLIENT_ID })
  })

  it("rejects an inconsistent packet-to-client organization chain", async () => {
    packetFindUnique.mockResolvedValue({ id: "packet-1", organizationId: ORG_A, clientId: CLIENT_ID, client: { organizationId: ORG_B } })
    const { requirePacketAccess } = await import("@/lib/live-authorization")
    await expect(requirePacketAccess("packet-1", "read", "read packet")).rejects.toThrow("Access denied")
  })

  it("denies approval submission by an assigned DSP", async () => {
    organizationMemberFindUnique.mockResolvedValue(membership("DSP"))
    const { requirePacketAccess } = await import("@/lib/live-authorization")
    await expect(requirePacketAccess("packet-1", "submit:approval", "submit approval")).rejects.toThrow("Access denied")
  })

  it("allows approval submission by an assigned Case Manager", async () => {
    const { requirePacketAccess } = await import("@/lib/live-authorization")
    await expect(requirePacketAccess("packet-1", "submit:approval", "submit approval")).resolves.toMatchObject({ role: "CASE_MANAGER" })
  })

  it("allows an assigned Case Manager to manage the target packet", async () => {
    const { requirePacketAccess } = await import("@/lib/live-authorization")
    await expect(requirePacketAccess("packet-1", "manage", "update packet")).resolves.toMatchObject({ role: "CASE_MANAGER" })
  })

  it("denies packet management to an assigned DSP", async () => {
    organizationMemberFindUnique.mockResolvedValue(membership("DSP"))
    const { requirePacketAccess } = await import("@/lib/live-authorization")
    await expect(requirePacketAccess("packet-1", "manage", "update packet")).rejects.toThrow("Access denied")
  })

  it("derives document access from the parent packet organization and client", async () => {
    const { requireDocumentAccess } = await import("@/lib/live-authorization")
    await expect(requireDocumentAccess("document-1", "read", "read document")).resolves.toMatchObject({ documentId: "document-1", packetId: "packet-1" })
  })

  it("rejects an inconsistent document packet-to-client organization chain", async () => {
    packetDocumentFindUnique.mockResolvedValue({
      id: "document-1",
      packet: { id: "packet-1", organizationId: ORG_A, clientId: CLIENT_ID, client: { organizationId: ORG_B } },
    })
    const { requireDocumentAccess } = await import("@/lib/live-authorization")
    await expect(requireDocumentAccess("document-1", "read", "read document")).rejects.toThrow("Access denied")
  })

  it("denies document writes to an assigned Nurse", async () => {
    organizationMemberFindUnique.mockResolvedValue(membership("NURSE"))
    const { requireDocumentAccess } = await import("@/lib/live-authorization")
    await expect(requireDocumentAccess("document-1", "write", "write document")).rejects.toThrow("Access denied")
  })

  it("enforces the client-creation role allowlist", async () => {
    const { CLIENT_CREATION_ROLES, requireOrganizationRole } = await import("@/lib/live-authorization")
    await expect(requireOrganizationRole(ORG_A, CLIENT_CREATION_ROLES, "create client")).rejects.toThrow("Access denied")
  })

  it.each(["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"])("allows client creation role %s", async (role) => {
    organizationMemberFindUnique.mockResolvedValue(membership(role))
    const { CLIENT_CREATION_ROLES, requireOrganizationRole } = await import("@/lib/live-authorization")
    await expect(requireOrganizationRole(ORG_A, CLIENT_CREATION_ROLES, "create client")).resolves.toMatchObject({ role })
  })

  it("accepts only an active assignee in the owning organization", async () => {
    const { requireActiveAssignableStaff } = await import("@/lib/live-authorization")
    await expect(requireActiveAssignableStaff(ORG_A, "assignee-1")).resolves.toBeUndefined()
  })

  it.each([null, "INVITED", "DISABLED"])("rejects an unavailable assignee (%s)", async (status) => {
    organizationMemberFindUnique.mockResolvedValue(status ? membership("DSP", status) : null)
    const { requireActiveAssignableStaff } = await import("@/lib/live-authorization")
    await expect(requireActiveAssignableStaff(ORG_A, "assignee-1")).rejects.toThrow("Access denied")
  })
})

describe("global Super Admin", () => {
  it("uses the live database flag when the JWT flag is stale false", async () => {
    authMock.mockResolvedValue(session({ isSuperAdmin: false }))
    userFindUnique.mockResolvedValue({ id: USER_ID, email: "admin@example.com", name: "Admin", isSuperAdmin: true })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_B })
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "read", "support investigation")).resolves.toMatchObject({
      role: "SUPER_ADMIN", organizationId: ORG_B, isCrossTenantSuperAdmin: true,
    })
    expect(organizationMemberFindUnique).not.toHaveBeenCalled()
  })

  it("ignores a stale true JWT flag when the live database flag is false", async () => {
    organizationMemberFindUnique.mockResolvedValue(null)
    const { requireActiveOrganizationMembership } = await import("@/lib/live-authorization")
    await expect(requireActiveOrganizationMembership(ORG_A, "test access")).rejects.toThrow("Access denied")
  })

  it("requires a reason for a global cross-tenant resource helper", async () => {
    userFindUnique.mockResolvedValue({ id: USER_ID, email: "admin@example.com", name: "Admin", isSuperAdmin: true })
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_B })
    const { requireClientAccess } = await import("@/lib/live-authorization")
    await expect(requireClientAccess(CLIENT_ID, "read", "  ")).rejects.toThrow("Access denied")
  })
})
