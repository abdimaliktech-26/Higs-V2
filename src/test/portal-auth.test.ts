import { describe, it, expect, vi, beforeEach } from "vitest"

const portalSessionFindUnique = vi.fn()
const portalSessionCreate = vi.fn()
const portalSessionUpdate = vi.fn()
const portalUserFindUnique = vi.fn()
const portalUserUpdate = vi.fn()
const portalClientAccessFindFirst = vi.fn()
const clientFindUnique = vi.fn()
const createPortalAuditEventMock = vi.fn()

const cookieStore = new Map<string, string>()
const cookiesMock = {
  get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  set: (name: string, value: string) => { cookieStore.set(name, value) },
  delete: (name: string) => { cookieStore.delete(name) },
}

vi.mock("@/lib/db", () => ({
  prisma: {
    portalSession: {
      findUnique: (...a: unknown[]) => portalSessionFindUnique(...a),
      create: (...a: unknown[]) => portalSessionCreate(...a),
      update: (...a: unknown[]) => portalSessionUpdate(...a),
    },
    portalUser: {
      findUnique: (...a: unknown[]) => portalUserFindUnique(...a),
      update: (...a: unknown[]) => portalUserUpdate(...a),
    },
    portalClientAccess: { findFirst: (...a: unknown[]) => portalClientAccessFindFirst(...a) },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
  },
}))
vi.mock("@/lib/audit", () => ({ createPortalAuditEvent: (...a: unknown[]) => createPortalAuditEventMock(...a) }))
vi.mock("next/headers", () => ({
  cookies: async () => cookiesMock,
  headers: async () => new Map(),
}))
vi.mock("@/lib/rate-limit", () => ({
  limiters: {
    portalLogin: { check: () => ({ allowed: true, remaining: 10, retryAfter: 0, total: 10, resetAt: 0 }) },
  },
}))

const PORTAL_USER_ID = "pu-1"

function activePortalUser(overrides: Record<string, unknown> = {}) {
  return {
    id: PORTAL_USER_ID,
    email: "guardian@example.com",
    passwordHash: null as string | null,
    status: "ACTIVE",
    emailVerifiedAt: new Date(),
    failedLoginCount: 0,
    lockedUntil: null as Date | null,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
})

describe("portalLogin", () => {
  it("logs in with valid credentials, creates a session, and sets the portal cookie", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12)
    portalUserFindUnique.mockResolvedValue(activePortalUser({ passwordHash }))
    portalSessionCreate.mockResolvedValue({ id: "sess-1" })

    const { portalLogin } = await import("@/lib/actions/portal-auth")
    const result = await portalLogin({ email: "guardian@example.com", password: "correct-horse-battery" })

    expect(result.success).toBe(true)
    expect(portalSessionCreate).toHaveBeenCalled()

    const { PORTAL_SESSION_COOKIE } = await import("@/lib/portal/session")
    expect(cookieStore.has(PORTAL_SESSION_COOKIE)).toBe(true)
    // Distinct from NextAuth's own cookie namespace, never reused.
    expect(PORTAL_SESSION_COOKIE).not.toMatch(/next-auth/i)

    const actions = createPortalAuditEventMock.mock.calls.map((c) => c[0].action)
    expect(actions).toContain("PORTAL_LOGIN_SUCCESS")
  })

  it("rejects an invalid password with a generic error and increments failedLoginCount", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12)
    portalUserFindUnique.mockResolvedValue(activePortalUser({ passwordHash }))

    const { portalLogin } = await import("@/lib/actions/portal-auth")
    const result = await portalLogin({ email: "guardian@example.com", password: "wrong-guess" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/invalid email or password/i)
    expect(portalUserUpdate).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failedLoginCount: 1 }) }))
    expect(portalSessionCreate).not.toHaveBeenCalled()

    const actions = createPortalAuditEventMock.mock.calls.map((c) => c[0].action)
    expect(actions).toContain("PORTAL_LOGIN_FAILED")
  })

  it("rejects an account that has not completed email verification", async () => {
    portalUserFindUnique.mockResolvedValue(activePortalUser({ status: "PENDING_VERIFICATION", emailVerifiedAt: null }))

    const { portalLogin } = await import("@/lib/actions/portal-auth")
    const result = await portalLogin({ email: "guardian@example.com", password: "whatever12345" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/activat/i)
    expect(portalSessionCreate).not.toHaveBeenCalled()
  })

  it.each(["SUSPENDED", "LOCKED", "DEACTIVATED"])("rejects a %s account with the generic error, never confirming account state", async (status) => {
    portalUserFindUnique.mockResolvedValue(activePortalUser({ status }))

    const { portalLogin } = await import("@/lib/actions/portal-auth")
    const result = await portalLogin({ email: "guardian@example.com", password: "whatever12345" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/invalid email or password/i)
  })

  it("rejects login while locked out, without touching the password", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12)
    portalUserFindUnique.mockResolvedValue(activePortalUser({ passwordHash, lockedUntil: new Date(Date.now() + 60000) }))

    const { portalLogin } = await import("@/lib/actions/portal-auth")
    const result = await portalLogin({ email: "guardian@example.com", password: "correct-horse-battery" })

    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error).toMatch(/locked/i)
    expect(portalUserUpdate).not.toHaveBeenCalled()
  })

  it("locks the account once failedLoginCount reaches the threshold", async () => {
    const bcrypt = (await import("bcryptjs")).default
    const passwordHash = await bcrypt.hash("correct-horse-battery", 12)
    portalUserFindUnique.mockResolvedValue(activePortalUser({ passwordHash, failedLoginCount: 4 }))

    const { portalLogin } = await import("@/lib/actions/portal-auth")
    await portalLogin({ email: "guardian@example.com", password: "wrong-guess" })

    const updateData = portalUserUpdate.mock.calls[0][0].data
    expect(updateData.failedLoginCount).toBe(5)
    expect(updateData.lockedUntil).toBeInstanceOf(Date)
  })
})

describe("requirePortalAuth / requirePortalClientAccess / requirePortalPermission", () => {
  it("rejects when no session cookie is present", async () => {
    const { requirePortalAuth } = await import("@/lib/portal/auth")
    await expect(requirePortalAuth()).rejects.toThrow()
  })

  it("rejects an expired or revoked session", async () => {
    portalSessionFindUnique.mockResolvedValue({
      id: "sess-1", revokedAt: null, expires: new Date(Date.now() - 1000),
      portalUser: activePortalUser(),
    })
    cookieStore.set("portal_session", "a".repeat(64))

    const { requirePortalAuth } = await import("@/lib/portal/auth")
    await expect(requirePortalAuth()).rejects.toThrow()
  })

  it("rejects a PortalUser that is not ACTIVE", async () => {
    portalSessionFindUnique.mockResolvedValue({
      id: "sess-1", revokedAt: null, expires: new Date(Date.now() + 60000),
      portalUser: activePortalUser({ status: "SUSPENDED" }),
    })
    cookieStore.set("portal_session", "a".repeat(64))

    const { requirePortalAuth } = await import("@/lib/portal/auth")
    await expect(requirePortalAuth()).rejects.toThrow()
  })

  it("rejects an unverified email even if status is ACTIVE", async () => {
    portalSessionFindUnique.mockResolvedValue({
      id: "sess-1", revokedAt: null, expires: new Date(Date.now() + 60000),
      portalUser: activePortalUser({ emailVerifiedAt: null }),
    })
    cookieStore.set("portal_session", "a".repeat(64))

    const { requirePortalAuth } = await import("@/lib/portal/auth")
    await expect(requirePortalAuth()).rejects.toThrow()
  })

  function validSession() {
    portalSessionFindUnique.mockResolvedValue({
      id: "sess-1", revokedAt: null, expires: new Date(Date.now() + 60000),
      portalUser: activePortalUser(),
    })
    cookieStore.set("portal_session", "a".repeat(64))
  }

  it("grants client access only for an active, non-expired, non-revoked grant matching the client's own org", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue({
      id: "access-1", organizationId: "org-1", accessRole: "GUARDIAN", relationship: "Mother",
      canViewDocuments: true, canUploadDocuments: false, canSignDocuments: false,
      canViewAppointments: false, canMessageCareTeam: false, canManageOtherGuardians: false,
    })
    clientFindUnique.mockResolvedValue({ organizationId: "org-1" })

    const { requirePortalClientAccess } = await import("@/lib/portal/auth")
    const context = await requirePortalClientAccess("client-1")
    expect(context.permissions.canViewDocuments).toBe(true)
  })

  it("rejects when the grant's organizationId does not match the client's current organizationId (cross-tenant mismatch)", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue({
      id: "access-1", organizationId: "org-1", accessRole: "GUARDIAN", relationship: "Mother",
      canViewDocuments: true, canUploadDocuments: false, canSignDocuments: false,
      canViewAppointments: false, canMessageCareTeam: false, canManageOtherGuardians: false,
    })
    clientFindUnique.mockResolvedValue({ organizationId: "org-DIFFERENT" })

    const { requirePortalClientAccess } = await import("@/lib/portal/auth")
    await expect(requirePortalClientAccess("client-1")).rejects.toThrow(/no active access/i)
  })

  it("rejects a client the PortalUser has no grant for (IDOR via direct URL/client-switcher tampering)", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue(null)

    const { requirePortalClientAccess } = await import("@/lib/portal/auth")
    await expect(requirePortalClientAccess("someone-elses-client")).rejects.toThrow(/no active access/i)
  })

  it("rejects a permission the grant does not have", async () => {
    validSession()
    portalClientAccessFindFirst.mockResolvedValue({
      id: "access-1", organizationId: "org-1", accessRole: "GUARDIAN", relationship: "Mother",
      canViewDocuments: false, canUploadDocuments: false, canSignDocuments: false,
      canViewAppointments: false, canMessageCareTeam: false, canManageOtherGuardians: false,
    })
    clientFindUnique.mockResolvedValue({ organizationId: "org-1" })

    const { requirePortalPermission } = await import("@/lib/portal/auth")
    await expect(requirePortalPermission("client-1", "canViewDocuments")).rejects.toThrow(/permission/i)
  })
})
