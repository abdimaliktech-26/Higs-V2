import { beforeEach, describe, expect, it, vi } from "vitest"

const packetFindUnique = vi.fn()
const packetUpdate = vi.fn()
const signatureRequestCount = vi.fn()
const approvalRequestCreate = vi.fn()
const approvalRequestFindUnique = vi.fn()
const approvalRequestFindMany = vi.fn()
const approvalRequestCount = vi.fn()
const approvalRequestUpdate = vi.fn()
const approvalEventCreate = vi.fn()
const requirePacketAccess = vi.fn()
const requireOrganizationRole = vi.fn()
const requireActiveOrganizationMembership = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    packet: {
      findUnique: (...args: unknown[]) => packetFindUnique(...args),
      update: (...args: unknown[]) => packetUpdate(...args),
    },
    signatureRequest: { count: (...args: unknown[]) => signatureRequestCount(...args) },
    approvalRequest: {
      create: (...args: unknown[]) => approvalRequestCreate(...args),
      findUnique: (...args: unknown[]) => approvalRequestFindUnique(...args),
      findMany: (...args: unknown[]) => approvalRequestFindMany(...args),
      count: (...args: unknown[]) => approvalRequestCount(...args),
      update: (...args: unknown[]) => approvalRequestUpdate(...args),
    },
    approvalEvent: { create: (...args: unknown[]) => approvalEventCreate(...args) },
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  APPROVAL_DECISION_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  APPROVAL_SUBMISSION_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"],
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requireActiveOrganizationMembership: (...args: unknown[]) => requireActiveOrganizationMembership(...args),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("@/lib/permissions", () => ({ requireOrgAccess: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const PACKET_ID = "packet-1"
const SUBMITTER_ID = "submitter-1"
const APPROVER_ID = "approver-1"

function authorization(userId: string, role = "ORG_ADMIN") {
  return { userId, organizationId: ORG_ID, role }
}

function requestRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "approval-1", organizationId: ORG_ID, packetId: PACKET_ID,
    submittedById: SUBMITTER_ID, status: "pending",
    packet: { id: PACKET_ID, organizationId: ORG_ID, documents: [] },
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  packetFindUnique.mockResolvedValue({ id: PACKET_ID, organizationId: ORG_ID, documents: [] })
  signatureRequestCount.mockResolvedValue(0)
  approvalRequestCreate.mockResolvedValue({ id: "approval-1" })
  approvalRequestFindUnique.mockResolvedValue(requestRow())
  approvalRequestFindMany.mockResolvedValue([])
  approvalRequestCount.mockResolvedValue(0)
  approvalRequestUpdate.mockResolvedValue({})
  approvalEventCreate.mockResolvedValue({})
  packetUpdate.mockResolvedValue({})
  requirePacketAccess.mockResolvedValue(authorization(SUBMITTER_ID, "CASE_MANAGER"))
  requireOrganizationRole.mockResolvedValue(authorization(APPROVER_ID))
  requireActiveOrganizationMembership.mockResolvedValue(authorization(SUBMITTER_ID, "CASE_MANAGER"))
  createAuditEvent.mockResolvedValue(undefined)
})

describe("approval reads use live role and assignment scope", () => {
  it("limits a Case Manager list to currently assigned clients", async () => {
    requireOrganizationRole.mockResolvedValue(authorization(SUBMITTER_ID, "CASE_MANAGER"))
    const { getApprovalRequests } = await import("@/lib/actions/approvals")
    await getApprovalRequests(ORG_ID)
    const where = approvalRequestFindMany.mock.calls[0][0].where
    expect(where.packet.client.assignments.some.staffUserId).toBe(SUBMITTER_ID)
    expect(where.packet.client.assignments.some.AND).toHaveLength(2)
  })

  it("keeps organization-wide approval lists unfiltered by assignment", async () => {
    const { getApprovalRequests } = await import("@/lib/actions/approvals")
    await getApprovalRequests(ORG_ID)
    expect(approvalRequestFindMany.mock.calls[0][0].where).not.toHaveProperty("packet")
  })

  it("authorizes detail from the owning packet before returning PHI", async () => {
    const { getApprovalDetail } = await import("@/lib/actions/approvals")
    await getApprovalDetail("approval-1")
    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "approval:read", "view approval request")
  })
})

describe("approval pilot actions use live target-organization authorization", () => {
  it("submits with the live actor returned for the packet-owning organization", async () => {
    const { submitForApproval } = await import("@/lib/actions/approvals")
    const result = await submitForApproval(PACKET_ID)
    expect(result.success).toBe(true)
    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "submit:approval", "submit packet for approval")
    expect(approvalRequestCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ organizationId: ORG_ID, submittedById: SUBMITTER_ID }),
    })
  })

  it("rejects submission immediately when live authorization fails", async () => {
    requirePacketAccess.mockRejectedValue(new Error("Access denied"))
    const { submitForApproval } = await import("@/lib/actions/approvals")
    await expect(submitForApproval(PACKET_ID)).resolves.toEqual({ success: false, error: "Access denied" })
    expect(approvalRequestCreate).not.toHaveBeenCalled()
  })

  it("preserves the pending-signature submission gate", async () => {
    signatureRequestCount.mockResolvedValue(2)
    const { submitForApproval } = await import("@/lib/actions/approvals")
    const result = await submitForApproval(PACKET_ID)
    expect(result).toMatchObject({ success: false })
    expect(approvalRequestCreate).not.toHaveBeenCalled()
  })

  it("blocks the submitter from approving the same request", async () => {
    requireOrganizationRole.mockResolvedValue(authorization(SUBMITTER_ID))
    const { decideApproval } = await import("@/lib/actions/approvals")
    const result = await decideApproval("approval-1", "approved")
    expect(result).toEqual({ success: false, error: "You cannot decide an approval request that you submitted" })
    expect(approvalRequestUpdate).not.toHaveBeenCalled()
  })

  it("records another authorized live user as approver", async () => {
    const { decideApproval } = await import("@/lib/actions/approvals")
    const result = await decideApproval("approval-1", "approved")
    expect(result.success).toBe(true)
    expect(requireOrganizationRole).toHaveBeenCalledWith(
      ORG_ID,
      ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
      "decide approval request",
    )
    expect(approvalRequestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ approverId: APPROVER_ID, status: "approved" }),
    }))
  })

  it("rejects an inconsistent packet and approval organization before authorization", async () => {
    approvalRequestFindUnique.mockResolvedValue(requestRow({ packet: { id: PACKET_ID, organizationId: "org-other", documents: [] } }))
    const { decideApproval } = await import("@/lib/actions/approvals")
    await expect(decideApproval("approval-1", "approved")).resolves.toEqual({ success: false, error: "Access denied" })
    expect(requireOrganizationRole).not.toHaveBeenCalled()
  })

  it("allows the live submitter to cancel", async () => {
    const { cancelApproval } = await import("@/lib/actions/approvals")
    const result = await cancelApproval("approval-1")
    expect(result.success).toBe(true)
    expect(approvalEventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({ eventType: "cancelled", createdById: SUBMITTER_ID }),
    })
  })

  it("denies cancellation to another non-approval role", async () => {
    requireActiveOrganizationMembership.mockResolvedValue(authorization("case-manager-2", "CASE_MANAGER"))
    const { cancelApproval } = await import("@/lib/actions/approvals")
    await expect(cancelApproval("approval-1")).resolves.toEqual({ success: false, error: "Access denied" })
    expect(approvalRequestUpdate).not.toHaveBeenCalled()
  })

  it("allows a different approval-role user to cancel", async () => {
    requireActiveOrganizationMembership.mockResolvedValue(authorization(APPROVER_ID, "COMPLIANCE_DIRECTOR"))
    const { cancelApproval } = await import("@/lib/actions/approvals")
    const result = await cancelApproval("approval-1")
    expect(result.success).toBe(true)
  })
})
