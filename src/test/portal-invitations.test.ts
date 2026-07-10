import { describe, it, expect, vi, beforeEach } from "vitest"
import { Prisma } from "@prisma/client"

const clientFindUnique = vi.fn()
const clientContactFindUnique = vi.fn()
const portalInvitationCreate = vi.fn()
const portalInvitationFindUnique = vi.fn()
const portalInvitationFindMany = vi.fn()
const portalInvitationUpdate = vi.fn()
const transactionMock = vi.fn()

const authMock = vi.fn()
const requireOrgAccessMock = vi.fn()
const getActiveRoleMock = vi.fn()
const createPortalAuditEventMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    clientContact: { findUnique: (...a: unknown[]) => clientContactFindUnique(...a) },
    portalInvitation: {
      create: (...a: unknown[]) => portalInvitationCreate(...a),
      findUnique: (...a: unknown[]) => portalInvitationFindUnique(...a),
      findMany: (...a: unknown[]) => portalInvitationFindMany(...a),
      update: (...a: unknown[]) => portalInvitationUpdate(...a),
    },
    $transaction: (...a: unknown[]) => transactionMock(...a),
  },
}))

vi.mock("@/lib/auth", () => ({ auth: (...a: unknown[]) => authMock(...a) }))
vi.mock("@/lib/permissions", () => ({
  requireOrgAccess: (...a: unknown[]) => requireOrgAccessMock(...a),
  getActiveRole: (...a: unknown[]) => getActiveRoleMock(...a),
}))
vi.mock("@/lib/audit", () => ({ createPortalAuditEvent: (...a: unknown[]) => createPortalAuditEventMock(...a) }))
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }))
vi.mock("next/headers", () => ({ headers: async () => new Map() }))
vi.mock("@/lib/rate-limit", () => ({
  limiters: {
    portalInvitationView: { check: () => ({ allowed: true, remaining: 10, retryAfter: 0, total: 10, resetAt: 0 }) },
    portalActivation: { check: () => ({ allowed: true, remaining: 10, retryAfter: 0, total: 10, resetAt: 0 }) },
  },
}))

const ORG_ID = "org-1"
const CLIENT_ID = "client-0000001"
const STAFF_ID = "staff-1"

function staffUser(overrides: Record<string, unknown> = {}) {
  return { id: STAFF_ID, isSuperAdmin: false, activeOrganizationId: ORG_ID, memberships: [], ...overrides }
}

function makeTx(overrides: Record<string, any> = {}) {
  return {
    portalInvitation: { findUnique: vi.fn(), updateMany: vi.fn().mockResolvedValue({ count: 1 }), ...overrides.portalInvitation },
    portalUser: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn(), update: vi.fn(), ...overrides.portalUser },
    portalClientAccess: { create: vi.fn().mockResolvedValue({ id: "pca-1" }), ...overrides.portalClientAccess },
  }
}

function futureDate() { return new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) }
function pastDate() { return new Date(Date.now() - 1000) }

function baseInvitation(overrides: Record<string, unknown> = {}) {
  return {
    id: "inv-1",
    organizationId: ORG_ID,
    clientId: CLIENT_ID,
    clientContactId: null,
    invitedEmail: "guardian@example.com",
    relationship: "Mother",
    accessRole: "GUARDIAN",
    requestedPermissions: { canViewDocuments: true, canViewAppointments: false, canMessageCareTeam: false },
    tokenHash: "irrelevant-in-mocked-lookup",
    status: "PENDING",
    expiresAt: futureDate(),
    acceptedAt: null,
    revokedAt: null,
    invitedByUserId: STAFF_ID,
    ...overrides,
  }
}

const VALID_RAW_TOKEN = "a".repeat(64)
const MALFORMED_TOKEN = "z".repeat(64) // right length, fails the hex-only shape check

beforeEach(() => {
  vi.clearAllMocks()
})

describe("createPortalInvitation", () => {
  it("creates an invitation for the correct tenant/client, stores a hashed token, and returns the raw token once", async () => {
    authMock.mockResolvedValue({ user: staffUser() })
    requireOrgAccessMock.mockResolvedValue(staffUser())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: ORG_ID })
    portalInvitationCreate.mockImplementation(async ({ data }: any) => ({ id: "inv-1", ...data }))

    const { createPortalInvitation } = await import("@/lib/actions/portal-invitations")
    const result = await createPortalInvitation({
      clientId: CLIENT_ID,
      invitedEmail: "Guardian@Example.com",
      relationship: "Mother",
      accessRole: "GUARDIAN",
      canViewDocuments: true,
      canViewAppointments: false,
      canMessageCareTeam: false,
    })

    expect(result.success).toBe(true)
    if (!result.success) return
    expect(result.data.rawToken).toMatch(/^[a-f0-9]{64}$/)

    const createCall = portalInvitationCreate.mock.calls[0][0].data
    expect(createCall.invitedEmail).toBe("guardian@example.com")
    expect(createCall.tokenHash).not.toBe(result.data.rawToken)
    expect(createCall.tokenHash).toMatch(/^[a-f0-9]{64}$/)

    // Audit metadata must never contain the raw token.
    const auditCall = createPortalAuditEventMock.mock.calls[0][0]
    expect(JSON.stringify(auditCall)).not.toContain(result.data.rawToken)
    expect(auditCall.action).toBe("PORTAL_INVITATION_SENT")
  })

  it("rejects a role without invitation-management permission", async () => {
    authMock.mockResolvedValue({ user: staffUser() })
    requireOrgAccessMock.mockResolvedValue(staffUser())
    getActiveRoleMock.mockReturnValue("CASE_MANAGER")

    const { createPortalInvitation } = await import("@/lib/actions/portal-invitations")
    const result = await createPortalInvitation({
      clientId: CLIENT_ID, invitedEmail: "guardian@example.com", relationship: "Mother", accessRole: "GUARDIAN",
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/insufficient permissions/i)
    expect(portalInvitationCreate).not.toHaveBeenCalled()
  })

  it("rejects a client belonging to a different organization", async () => {
    authMock.mockResolvedValue({ user: staffUser() })
    requireOrgAccessMock.mockResolvedValue(staffUser())
    getActiveRoleMock.mockReturnValue("ORG_ADMIN")
    clientFindUnique.mockResolvedValue({ id: CLIENT_ID, organizationId: "org-OTHER" })

    const { createPortalInvitation } = await import("@/lib/actions/portal-invitations")
    const result = await createPortalInvitation({
      clientId: CLIENT_ID, invitedEmail: "guardian@example.com", relationship: "Mother", accessRole: "GUARDIAN",
    })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/client not found/i)
    expect(portalInvitationCreate).not.toHaveBeenCalled()
  })
})

describe("getPortalInvitations — tenant isolation", () => {
  it("rejects listing invitations for an organization the staff member cannot access", async () => {
    requireOrgAccessMock.mockRejectedValue(new Error("Access denied"))

    const { getPortalInvitations } = await import("@/lib/actions/portal-invitations")
    await expect(getPortalInvitations("org-OTHER")).rejects.toThrow("Access denied")
    expect(portalInvitationFindMany).not.toHaveBeenCalled()
  })
})

describe("activatePortalAccount — invitation lifecycle", () => {
  it("accepts a valid token, creates a new PortalUser, and grants access with safe defaults", async () => {
    const tx = makeTx({ portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation()) } })
    tx.portalUser.create.mockResolvedValue({ id: "pu-new" })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(true)

    // New user created without forcing status — relies on the PENDING_VERIFICATION schema default —
    // then explicitly finalized to ACTIVE in a second write.
    const createData = tx.portalUser.create.mock.calls[0][0].data
    expect(createData).not.toHaveProperty("status")
    expect(createData.email).toBe("guardian@example.com")

    const updateData = tx.portalUser.update.mock.calls[0][0].data
    expect(updateData.status).toBe("ACTIVE")
    expect(updateData.emailVerifiedAt).toBeInstanceOf(Date)

    const accessData = tx.portalClientAccess.create.mock.calls[0][0].data
    expect(accessData.portalUserId).toBe("pu-new")
    expect(accessData.canViewDocuments).toBe(true)
    expect(accessData.canUploadDocuments).toBe(false)
    expect(accessData.canSignDocuments).toBe(false)
    expect(accessData.canManageOtherGuardians).toBe(false)

    const actions = createPortalAuditEventMock.mock.calls.map((c) => c[0].action)
    expect(actions).toEqual(expect.arrayContaining(["PORTAL_INVITATION_ACCEPTED", "PORTAL_ACCESS_GRANTED", "PORTAL_EMAIL_VERIFIED"]))
    expect(JSON.stringify(createPortalAuditEventMock.mock.calls)).not.toContain(VALID_RAW_TOKEN)
  })

  it("never grants sign/upload/manage-guardian permissions even if requestedPermissions is tampered with", async () => {
    const tamperedInvitation = baseInvitation({
      requestedPermissions: { canViewDocuments: true, canSignDocuments: true, canUploadDocuments: true, canManageOtherGuardians: true },
    })
    const tx = makeTx({ portalInvitation: { findUnique: vi.fn().mockResolvedValue(tamperedInvitation) } })
    tx.portalUser.create.mockResolvedValue({ id: "pu-new" })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(true)
    const accessData = tx.portalClientAccess.create.mock.calls[0][0].data
    expect(accessData.canSignDocuments).toBe(false)
    expect(accessData.canUploadDocuments).toBe(false)
    expect(accessData.canManageOtherGuardians).toBe(false)
  })

  it("rejects an expired invitation without touching the portal user", async () => {
    const tx = makeTx({ portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation({ expiresAt: pastDate() })) } })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/expired/i)
    expect(tx.portalUser.findUnique).not.toHaveBeenCalled()
  })

  it("rejects a revoked invitation", async () => {
    const tx = makeTx({ portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation({ revokedAt: new Date() })) } })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/revoked/i)
  })

  it("rejects a previously accepted invitation", async () => {
    const tx = makeTx({ portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation({ acceptedAt: new Date() })) } })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already been used/i)
  })

  it("rejects a malformed token before ever touching the database", async () => {
    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: MALFORMED_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/invalid/i)
    expect(transactionMock).not.toHaveBeenCalled()
  })

  it("prevents double acceptance when the conditional update loses a race", async () => {
    const tx = makeTx({
      portalInvitation: {
        findUnique: vi.fn().mockResolvedValue(baseInvitation()),
        updateMany: vi.fn().mockResolvedValue({ count: 0 }), // another request already accepted it
      },
    })
    tx.portalUser.create.mockResolvedValue({ id: "pu-new" })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already been used/i)
    expect(tx.portalClientAccess.create).not.toHaveBeenCalled()
  })

  it("gracefully handles a partial-unique-index conflict instead of crashing", async () => {
    const tx = makeTx({ portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation()) } })
    tx.portalUser.create.mockResolvedValue({ id: "pu-new" })
    tx.portalClientAccess.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("Unique constraint failed", { code: "P2002", clientVersion: "test" })
    )
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "supersecurepassword123" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/already has active access|already exists/i)
  })
})

describe("activatePortalAccount — existing PortalUser", () => {
  it("reuses an existing PortalUser instead of creating a duplicate, when the password matches", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12)
    const existing = { id: "pu-existing", email: "guardian@example.com", status: "ACTIVE", passwordHash, emailVerifiedAt: new Date() }

    const tx = makeTx({
      portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation()) },
      portalUser: { findUnique: vi.fn().mockResolvedValue(existing) },
    })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "correct-horse-battery" })

    expect(result.success).toBe(true)
    expect(tx.portalUser.create).not.toHaveBeenCalled()
    expect(tx.portalUser.update).not.toHaveBeenCalled() // already ACTIVE + verified, nothing to finalize
    expect(tx.portalClientAccess.create.mock.calls[0][0].data.portalUserId).toBe("pu-existing")
  })

  it("rejects an incorrect password for an existing account without accepting the invitation", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12)
    const existing = { id: "pu-existing", email: "guardian@example.com", status: "ACTIVE", passwordHash, emailVerifiedAt: new Date() }

    const tx = makeTx({
      portalInvitation: { findUnique: vi.fn().mockResolvedValue(baseInvitation()) },
      portalUser: { findUnique: vi.fn().mockResolvedValue(existing) },
    })
    transactionMock.mockImplementation(async (cb: any) => cb(tx))

    const { activatePortalAccount } = await import("@/lib/actions/portal-invitations")
    const result = await activatePortalAccount({ token: VALID_RAW_TOKEN, password: "wrong-password-guess" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/incorrect password/i)
    expect(tx.portalInvitation.updateMany).not.toHaveBeenCalled()
    expect(tx.portalClientAccess.create).not.toHaveBeenCalled()
  })
})
