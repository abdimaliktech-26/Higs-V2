import { beforeEach, describe, expect, it, vi } from "vitest"

const requireActiveOrganizationMembership = vi.fn()
const requireOrganizationRole = vi.fn()
const notificationFindMany = vi.fn()
const notificationFindUnique = vi.fn()
const notificationFindFirst = vi.fn()
const notificationCount = vi.fn()
const notificationUpdate = vi.fn()
const notificationCreate = vi.fn()
const packetFindMany = vi.fn()
const validationResultFindMany = vi.fn()
const signatureRequestFindMany = vi.fn()
const approvalRequestFindMany = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  CLIENT_READ_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"],
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  SIGNATURE_MANAGEMENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"],
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    notification: {
      findMany: (...args: unknown[]) => notificationFindMany(...args),
      findUnique: (...args: unknown[]) => notificationFindUnique(...args),
      findFirst: (...args: unknown[]) => notificationFindFirst(...args),
      count: (...args: unknown[]) => notificationCount(...args),
      update: (...args: unknown[]) => notificationUpdate(...args),
      create: (...args: unknown[]) => notificationCreate(...args),
    },
    packet: { findMany: (...args: unknown[]) => packetFindMany(...args) },
    validationResult: { findMany: (...args: unknown[]) => validationResultFindMany(...args) },
    signatureRequest: { findMany: (...args: unknown[]) => signatureRequestFindMany(...args) },
    approvalRequest: { findMany: (...args: unknown[]) => approvalRequestFindMany(...args) },
  },
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const USER_ID = "case-manager-1"

beforeEach(() => {
  vi.clearAllMocks()
  requireActiveOrganizationMembership.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  requireOrganizationRole.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  notificationFindMany.mockResolvedValue([])
  notificationCount.mockResolvedValue(0)
  notificationFindFirst.mockResolvedValue(null)
  notificationUpdate.mockResolvedValue({})
  notificationCreate.mockResolvedValue({})
  packetFindMany.mockResolvedValue([])
  validationResultFindMany.mockResolvedValue([])
  signatureRequestFindMany.mockResolvedValue([])
  approvalRequestFindMany.mockResolvedValue([])
  createAuditEvent.mockResolvedValue(undefined)
})

describe("notifications are live and user scoped", () => {
  it("lists and counts only the live actor's notifications", async () => {
    const { getNotifications } = await import("@/lib/actions/notifications")
    await getNotifications(ORG_ID, { unreadOnly: true })
    expect(notificationFindMany.mock.calls[0][0].where).toMatchObject({ organizationId: ORG_ID, userId: USER_ID, readAt: null })
    expect(notificationCount.mock.calls[1][0].where).toMatchObject({ organizationId: ORG_ID, userId: USER_ID })
  })

  it("does not let one organization member mutate another user's notification", async () => {
    notificationFindUnique.mockResolvedValue({ id: "notification-1", organizationId: ORG_ID, userId: "other-user" })
    const { markNotificationRead } = await import("@/lib/actions/notifications")
    await expect(markNotificationRead("notification-1")).resolves.toEqual({ success: false, error: "Not found" })
    expect(notificationUpdate).not.toHaveBeenCalled()
  })

  it("scopes Case Manager notification generation to current client assignments", async () => {
    const { generateNotifications } = await import("@/lib/actions/notifications")
    await generateNotifications(ORG_ID)
    const packetAssignments = packetFindMany.mock.calls[0][0].where.client.assignments
    const signatureAssignments = signatureRequestFindMany.mock.calls[0][0].where.packet.client.assignments
    expect(packetAssignments.some.staffUserId).toBe(USER_ID)
    expect(packetAssignments.some.AND).toHaveLength(2)
    expect(signatureAssignments.some.staffUserId).toBe(USER_ID)
  })

  it("does not generate signature-administration notifications for DSP", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "dsp-1", organizationId: ORG_ID, role: "DSP" })
    const { generateNotifications } = await import("@/lib/actions/notifications")
    await generateNotifications(ORG_ID)
    expect(signatureRequestFindMany).not.toHaveBeenCalled()
    expect(validationResultFindMany).not.toHaveBeenCalled()
    expect(approvalRequestFindMany).not.toHaveBeenCalled()
  })
})
