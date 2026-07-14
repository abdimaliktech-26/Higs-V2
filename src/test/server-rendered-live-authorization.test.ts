import { beforeEach, describe, expect, it, vi } from "vitest"

const requireOrganizationRole = vi.fn()
const requireActiveOrganizationMembership = vi.fn()
const requirePacketAccess = vi.fn()
const requireGlobalSuperAdmin = vi.fn()
const programFindMany = vi.fn()
const clientFindMany = vi.fn()
const clientCount = vi.fn()
const packetFindMany = vi.fn()
const packetFindFirst = vi.fn()
const signatureRequestFindMany = vi.fn()
const approvalRequestFindMany = vi.fn()
const validationResultFindMany = vi.fn()
const auditEventFindMany = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  CLIENT_READ_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"],
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
  requireGlobalSuperAdmin: (...args: unknown[]) => requireGlobalSuperAdmin(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    program: { findMany: (...args: unknown[]) => programFindMany(...args) },
    client: {
      findMany: (...args: unknown[]) => clientFindMany(...args),
      count: (...args: unknown[]) => clientCount(...args),
    },
    packet: {
      findMany: (...args: unknown[]) => packetFindMany(...args),
      findFirst: (...args: unknown[]) => packetFindFirst(...args),
    },
    signatureRequest: { findMany: (...args: unknown[]) => signatureRequestFindMany(...args) },
    approvalRequest: { findMany: (...args: unknown[]) => approvalRequestFindMany(...args) },
    validationResult: { findMany: (...args: unknown[]) => validationResultFindMany(...args) },
    auditEvent: { findMany: (...args: unknown[]) => auditEventFindMany(...args) },
    organization: { count: vi.fn().mockResolvedValue(0) },
    user: { count: vi.fn().mockResolvedValue(0) },
  },
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))

const ORG_ID = "org-1"
const USER_ID = "case-1"

beforeEach(() => {
  vi.clearAllMocks()
  const authorization = { userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" }
  requireOrganizationRole.mockResolvedValue(authorization)
  requireActiveOrganizationMembership.mockResolvedValue(authorization)
  requirePacketAccess.mockResolvedValue({ ...authorization, packetId: "packet-1", clientId: "client-1" })
  requireGlobalSuperAdmin.mockResolvedValue({ userId: "admin-1", isGlobalSuperAdmin: true })
  programFindMany.mockResolvedValue([])
  clientFindMany.mockResolvedValue([])
  clientCount.mockResolvedValue(0)
  packetFindMany.mockResolvedValue([])
  packetFindFirst.mockResolvedValue(null)
  signatureRequestFindMany.mockResolvedValue([])
  approvalRequestFindMany.mockResolvedValue([])
  validationResultFindMany.mockResolvedValue([])
  auditEventFindMany.mockResolvedValue([])
  createAuditEvent.mockResolvedValue(undefined)
})

describe("server-rendered data uses live authorization", () => {
  it("assignment-scopes all PHI-bearing dashboard aggregates and self-scopes audit activity", async () => {
    const { DashboardContent } = await import("@/app/dashboard/dashboard-content")
    await DashboardContent({ orgId: ORG_ID, isSuperAdmin: true, userId: "stale-user", role: "SUPER_ADMIN", userName: "Case Manager" })

    expect(requireOrganizationRole).toHaveBeenCalledWith(ORG_ID, expect.any(Array), "view organization dashboard")
    const assignment = clientCount.mock.calls[0][0].where.assignments.some
    expect(assignment.staffUserId).toBe(USER_ID)
    expect(assignment.AND).toHaveLength(2)
    expect(packetFindMany.mock.calls[0][0].where.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(validationResultFindMany.mock.calls[0][0].where.packet.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(validationResultFindMany.mock.calls[1][0].where.packet.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(auditEventFindMany.mock.calls[0][0].where.actorId).toBe(USER_ID)
  })

  it("requires live global Super Admin access before platform dashboard counts", async () => {
    const { DashboardContent } = await import("@/app/dashboard/dashboard-content")
    await DashboardContent({ isSuperAdmin: true, userId: "stale-admin", role: "SUPER_ADMIN" })
    expect(requireGlobalSuperAdmin).toHaveBeenCalledWith("view platform dashboard")
  })

  it("assignment-scopes analytics instead of trusting the page role", async () => {
    const { getClientsByProgram, getMonthlyClientGrowth } = await import("@/app/analytics-studio/analytics-data")
    await getClientsByProgram(ORG_ID)
    await getMonthlyClientGrowth(ORG_ID)
    expect(programFindMany.mock.calls[0][0].select._count.select.enrollments.where.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(clientFindMany.mock.calls[0][0].where.assignments.some.AND).toHaveLength(2)
  })

  it("authorizes notification focus by packet and assignment-scopes deadlines", async () => {
    const { getNotificationFocusPacket, getUpcomingDeadlines } = await import("@/app/notifications/notifications-data")
    await getNotificationFocusPacket(ORG_ID, "packet-1")
    await getUpcomingDeadlines(ORG_ID)
    expect(requirePacketAccess).toHaveBeenCalledWith("packet-1", "read", "view notification packet context")
    expect(packetFindMany.mock.calls[0][0].where.client.assignments.some.staffUserId).toBe(USER_ID)
  })

  it("requires current active membership for organization program configuration reads", async () => {
    const { getOrgPrograms } = await import("@/app/settings/organization/org-settings-data")
    await getOrgPrograms(ORG_ID)
    expect(requireActiveOrganizationMembership).toHaveBeenCalledWith(ORG_ID, "view organization programs")
  })
})
