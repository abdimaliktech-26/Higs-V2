import { beforeEach, describe, expect, it, vi } from "vitest"

const requireOrganizationRole = vi.fn()
const clientGroupBy = vi.fn()
const packetFindMany = vi.fn()
const packetDocumentFindMany = vi.fn()
const validationResultFindMany = vi.fn()
const signatureRequestFindMany = vi.fn()
const approvalRequestFindMany = vi.fn()
const supportingDocumentCount = vi.fn()
const auditEventGroupBy = vi.fn()
const programFindMany = vi.fn()
const userFindMany = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  CLIENT_READ_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"],
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    client: { groupBy: (...args: unknown[]) => clientGroupBy(...args) },
    packet: { findMany: (...args: unknown[]) => packetFindMany(...args) },
    packetDocument: { findMany: (...args: unknown[]) => packetDocumentFindMany(...args) },
    validationResult: { findMany: (...args: unknown[]) => validationResultFindMany(...args) },
    signatureRequest: { findMany: (...args: unknown[]) => signatureRequestFindMany(...args) },
    approvalRequest: { findMany: (...args: unknown[]) => approvalRequestFindMany(...args) },
    supportingDocument: { count: (...args: unknown[]) => supportingDocumentCount(...args) },
    auditEvent: { groupBy: (...args: unknown[]) => auditEventGroupBy(...args) },
    program: { findMany: (...args: unknown[]) => programFindMany(...args) },
    user: { findMany: (...args: unknown[]) => userFindMany(...args) },
  },
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))

const ORG_ID = "org-1"
const USER_ID = "case-manager-1"

beforeEach(() => {
  vi.clearAllMocks()
  requireOrganizationRole.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  clientGroupBy.mockResolvedValue([])
  packetFindMany.mockResolvedValue([])
  packetDocumentFindMany.mockResolvedValue([])
  validationResultFindMany.mockResolvedValue([])
  signatureRequestFindMany.mockResolvedValue([])
  approvalRequestFindMany.mockResolvedValue([])
  supportingDocumentCount.mockResolvedValue(0)
  auditEventGroupBy.mockResolvedValue([])
  programFindMany.mockResolvedValue([])
  userFindMany.mockResolvedValue([])
  createAuditEvent.mockResolvedValue(undefined)
})

describe("reports use live role and assignment scope", () => {
  it("applies current assignment scope to every client-bearing aggregate", async () => {
    const { getReportsData } = await import("@/lib/actions/reports")
    await getReportsData(ORG_ID)

    const clientAssignments = clientGroupBy.mock.calls[0][0].where.assignments
    const packetAssignments = packetFindMany.mock.calls[0][0].where.client.assignments
    const signatureAssignments = signatureRequestFindMany.mock.calls[0][0].where.packet.client.assignments
    const approvalAssignments = approvalRequestFindMany.mock.calls[0][0].where.packet.client.assignments
    const supportingAssignments = supportingDocumentCount.mock.calls[0][0].where.client.assignments

    for (const assignments of [clientAssignments, packetAssignments, signatureAssignments, approvalAssignments, supportingAssignments]) {
      expect(assignments.some.staffUserId).toBe(USER_ID)
      expect(assignments.some.AND).toHaveLength(2)
    }
    expect(auditEventGroupBy.mock.calls[0][0].where.actorId).toBe(USER_ID)
  })

  it("does not assignment-filter organization-wide report roles", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "admin-1", organizationId: ORG_ID, role: "ORG_ADMIN" })
    const { getReportsData } = await import("@/lib/actions/reports")
    await getReportsData(ORG_ID)
    expect(clientGroupBy.mock.calls[0][0].where).not.toHaveProperty("assignments")
    expect(packetFindMany.mock.calls[0][0].where).not.toHaveProperty("client")
    expect(signatureRequestFindMany.mock.calls[0][0].where).not.toHaveProperty("packet")
    expect(approvalRequestFindMany.mock.calls[0][0].where).not.toHaveProperty("packet")
  })

  it("records the live actor on the report audit event", async () => {
    const { getReportsData } = await import("@/lib/actions/reports")
    await getReportsData(ORG_ID)
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ organizationId: ORG_ID, actorId: USER_ID }))
  })
})
