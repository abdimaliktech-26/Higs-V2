import { beforeEach, describe, expect, it, vi } from "vitest"

const signatureRequestFindMany = vi.fn()
const signatureRequestFindUnique = vi.fn()
const signatureRequestCount = vi.fn()
const requireOrganizationRole = vi.fn()
const requirePacketAccess = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    signatureRequest: {
      findMany: (...args: unknown[]) => signatureRequestFindMany(...args),
      findUnique: (...args: unknown[]) => signatureRequestFindUnique(...args),
      count: (...args: unknown[]) => signatureRequestCount(...args),
    },
  },
}))
vi.mock("@/lib/live-authorization", () => ({
  ORGANIZATION_WIDE_CLIENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"],
  SIGNATURE_MANAGEMENT_ROLES: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"],
  requireOrganizationRole: (...args: unknown[]) => requireOrganizationRole(...args),
  requirePacketAccess: (...args: unknown[]) => requirePacketAccess(...args),
  requireClientAccess: vi.fn(),
}))
vi.mock("@/lib/audit", () => ({ createAuditEvent: vi.fn(), createPortalAuditEvent: vi.fn() }))
vi.mock("@/lib/portal/auth", () => ({ requirePortalPermission: vi.fn(), requirePortalClientAccess: vi.fn() }))
vi.mock("@/lib/rate-limit", () => ({ limiters: { signature: {} }, checkRateLimit: vi.fn() }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: vi.fn() }))

const ORG_ID = "org-1"
const PACKET_ID = "packet-1"
const USER_ID = "case-manager-1"

beforeEach(() => {
  vi.clearAllMocks()
  signatureRequestFindMany.mockResolvedValue([])
  signatureRequestCount.mockResolvedValue(0)
  signatureRequestFindUnique.mockResolvedValue({ id: "signature-1", organizationId: ORG_ID, packetId: PACKET_ID })
  requireOrganizationRole.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
  requirePacketAccess.mockResolvedValue({ userId: USER_ID, organizationId: ORG_ID, role: "CASE_MANAGER" })
})

describe("staff signature reads use live resource authorization", () => {
  it("limits a Case Manager list to current client assignments", async () => {
    const { getSignatureRequests } = await import("@/lib/actions/signatures")
    await getSignatureRequests(ORG_ID)
    const where = signatureRequestFindMany.mock.calls[0][0].where
    expect(where.packet.client.assignments.some.staffUserId).toBe(USER_ID)
    expect(where.packet.client.assignments.some.AND).toHaveLength(2)
  })

  it("does not assignment-filter organization-wide roles", async () => {
    requireOrganizationRole.mockResolvedValue({ userId: "admin-1", organizationId: ORG_ID, role: "ORG_ADMIN" })
    const { getSignatureRequests } = await import("@/lib/actions/signatures")
    await getSignatureRequests(ORG_ID)
    expect(signatureRequestFindMany.mock.calls[0][0].where).not.toHaveProperty("packet")
  })

  it("authorizes detail from the owning packet before the detailed PHI read", async () => {
    const { getSignatureDetail } = await import("@/lib/actions/signatures")
    await getSignatureDetail("signature-1")
    expect(requirePacketAccess).toHaveBeenCalledWith(PACKET_ID, "signature:manage", "view signature request")
    expect(signatureRequestFindUnique).toHaveBeenCalledTimes(2)
  })

  it("returns no detail when the signature organization disagrees with the packet authorization", async () => {
    requirePacketAccess.mockResolvedValue({ userId: USER_ID, organizationId: "org-other", role: "CASE_MANAGER" })
    const { getSignatureDetail } = await import("@/lib/actions/signatures")
    await expect(getSignatureDetail("signature-1")).resolves.toBeNull()
    expect(signatureRequestFindUnique).toHaveBeenCalledTimes(1)
  })
})
