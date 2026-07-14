import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

const requireOrganizationRole = vi.fn()
const requirePacketAccess = vi.fn()
const validationResultFindMany = vi.fn()
const validationResultFindUnique = vi.fn()
const validationResultCount = vi.fn()
const validationResultUpdate = vi.fn()
const validationIssueFindUnique = vi.fn()
const validationIssueFindMany = vi.fn()
const validationIssueUpdate = vi.fn()
const createAuditEvent = vi.fn()

vi.mock("@/lib/live-authorization", () => ({
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  getLiveStaffAuthorizationContext: vi.fn(),
  requireActiveOrganizationMembership: vi.fn(),
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
}))
vi.mock("@/lib/db", () => ({
  prisma: {
    validationResult: {
      findMany: (...args: unknown[]) => validationResultFindMany(...args),
      findUnique: (...args: unknown[]) => validationResultFindUnique(...args),
      count: (...args: unknown[]) => validationResultCount(...args),
      update: (...args: unknown[]) => validationResultUpdate(...args),
    },
    validationIssue: {
      findUnique: (...args: unknown[]) => validationIssueFindUnique(...args),
      findMany: (...args: unknown[]) => validationIssueFindMany(...args),
      update: (...args: unknown[]) => validationIssueUpdate(...args),
    },
  },
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: (...args: unknown[]) => createAuditEvent(...args) }))
vi.mock("@/lib/conditions/runtime", () => ({ buildPacketConditionContext: vi.fn(), buildEditorDocumentConditionState: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ limiters: { validation: {} }, checkRateLimit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))

const ORG_ID = "org-1"
const PACKET_ID = "packet-1"
const USER_ID = "case-manager-1"
const RESULT_ID = "result-1"

beforeEach(() => {
  vi.clearAllMocks()
  requireOrganizationRole.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  requirePacketAccess.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  validationResultFindMany.mockResolvedValue([])
  validationResultCount.mockResolvedValue(0)
  validationResultFindUnique.mockResolvedValue({ id: RESULT_ID, packetId: PACKET_ID, organizationId: ORG_ID })
  validationIssueFindUnique
    .mockResolvedValueOnce({ validationResult: { packetId: PACKET_ID, organizationId: ORG_ID } })
    .mockResolvedValueOnce({ id: "issue-1", validationResult: { id: RESULT_ID, packetId: PACKET_ID, organizationId: ORG_ID } })
  validationIssueFindMany.mockResolvedValue([])
  validationIssueUpdate.mockResolvedValue({})
  validationResultUpdate.mockResolvedValue({})
  createAuditEvent.mockResolvedValue(undefined)
})

describe("validation reads and issue resolution use live packet scope", () => {
  it("limits Case Manager validation lists to current client assignments", async () => {
    const { getValidationResults } = await import("@/lib/actions/validation")
    await getValidationResults(ORG_ID)
    const where = validationResultFindMany.mock.calls[0][0].where
    expect(where.packet.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(where.packet.client.assignments.some.AND).toHaveLength(2)
  })

  it("does not assignment-filter organization-wide validation lists", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "admin-1", organizationId: ORG_ID, role: "ORG_ADMIN" })
    const { getValidationResults } = await import("@/lib/actions/validation")
    await getValidationResults(ORG_ID)
    expect(validationResultFindMany.mock.calls[0][0].where).not.toHaveProperty("packet")
  })

  it("authorizes validation detail from its owning packet before the detailed read", async () => {
    const { getValidationResultDetail } = await import("@/lib/actions/validation")
    await getValidationResultDetail(RESULT_ID)
    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "manage", "view validation result")
    expect(validationResultFindUnique).toHaveBeenCalledTimes(2)
  })

  it("uses the live packet actor when resolving a validation issue", async () => {
    const { resolveValidationIssue } = await import("@/lib/actions/validation")
    const result = await resolveValidationIssue("issue-1")
    expect(result.success).toBe(true)
    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "manage", "resolve validation issue")
    expect(validationIssueUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ resolvedById: USER_ID }) }))
    expect(createAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ actorId: USER_ID, organizationId: ORG_ID }))
  })
})
