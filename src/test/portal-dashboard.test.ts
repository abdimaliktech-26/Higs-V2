import { describe, it, expect, vi, beforeEach } from "vitest"

const portalSessionFindUnique = vi.fn()
const portalClientAccessFindFirst = vi.fn()
const portalClientAccessFindMany = vi.fn()
const clientFindUnique = vi.fn()
const packetFindFirst = vi.fn()
const packetDocumentFindMany = vi.fn()
const supportingDocumentFindMany = vi.fn()
const staffAssignmentFindMany = vi.fn()
const portalNotificationFindMany = vi.fn()
const portalAuditEventFindMany = vi.fn()

const cookieStore = new Map<string, string>()
const cookiesMock = {
  get: (name: string) => (cookieStore.has(name) ? { value: cookieStore.get(name) } : undefined),
  set: (name: string, value: string) => { cookieStore.set(name, value) },
  delete: (name: string) => { cookieStore.delete(name) },
}

vi.mock("@/lib/db", () => ({
  prisma: {
    portalSession: { findUnique: (...a: unknown[]) => portalSessionFindUnique(...a) },
    portalClientAccess: {
      findFirst: (...a: unknown[]) => portalClientAccessFindFirst(...a),
      findMany: (...a: unknown[]) => portalClientAccessFindMany(...a),
    },
    client: { findUnique: (...a: unknown[]) => clientFindUnique(...a) },
    packet: { findFirst: (...a: unknown[]) => packetFindFirst(...a) },
    packetDocument: { findMany: (...a: unknown[]) => packetDocumentFindMany(...a) },
    supportingDocument: { findMany: (...a: unknown[]) => supportingDocumentFindMany(...a) },
    staffAssignment: { findMany: (...a: unknown[]) => staffAssignmentFindMany(...a) },
    portalNotification: { findMany: (...a: unknown[]) => portalNotificationFindMany(...a) },
    portalAuditEvent: { findMany: (...a: unknown[]) => portalAuditEventFindMany(...a) },
    portalUser: { findUnique: vi.fn() },
  },
}))
vi.mock("next/headers", () => ({ cookies: async () => cookiesMock, headers: async () => new Map() }))

const PORTAL_USER_ID = "pu-1"
const CLIENT_ID = "client-0000001"

function activeAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1", organizationId: "org-1", accessRole: "GUARDIAN", relationship: "Mother",
    canViewDocuments: true, canUploadDocuments: false, canSignDocuments: false,
    canViewAppointments: false, canMessageCareTeam: false, canManageOtherGuardians: false,
    ...overrides,
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  cookieStore.clear()
  cookieStore.set("portal_session", "a".repeat(64))
  portalSessionFindUnique.mockResolvedValue({
    id: "sess-1", revokedAt: null, expires: new Date(Date.now() + 60000),
    portalUser: { id: PORTAL_USER_ID, email: "guardian@example.com", status: "ACTIVE", emailVerifiedAt: new Date() },
  })
  clientFindUnique.mockResolvedValue({ organizationId: "org-1" })
})

describe("getPortalDocuments — visibility enforcement", () => {
  it("never returns portalVisible=false documents (query itself scopes on portalVisible: true)", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindMany.mockResolvedValue([])
    supportingDocumentFindMany.mockResolvedValue([])

    const { getPortalDocuments } = await import("@/lib/actions/portal-dashboard")
    await getPortalDocuments(CLIENT_ID)

    const packetWhere = packetDocumentFindMany.mock.calls[0][0].where
    const supportingWhere = supportingDocumentFindMany.mock.calls[0][0].where
    expect(packetWhere.portalVisible).toBe(true)
    expect(supportingWhere.portalVisible).toBe(true)
  })

  it("rejects reading documents without canViewDocuments, even with active client access", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess({ canViewDocuments: false }))

    const { getPortalDocuments } = await import("@/lib/actions/portal-dashboard")
    await expect(getPortalDocuments(CLIENT_ID)).rejects.toThrow(/permission/i)
    expect(packetDocumentFindMany).not.toHaveBeenCalled()
  })

  it("only generates a download URL for VIEW_AND_DOWNLOAD documents, never for VIEW-only ones", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindMany.mockResolvedValue([
      { id: "pd-view", status: "completed", updatedAt: new Date(), portalAccessLevel: "VIEW", documentTemplate: { name: "Consent Form" } },
      { id: "pd-download", status: "completed", updatedAt: new Date(), portalAccessLevel: "VIEW_AND_DOWNLOAD", documentTemplate: { name: "ISP" } },
    ])
    supportingDocumentFindMany.mockResolvedValue([])

    const { getPortalDocuments } = await import("@/lib/actions/portal-dashboard")
    const docs = await getPortalDocuments(CLIENT_ID)

    const viewOnly = docs.find((d) => d.id === "pd-view")!
    const viewAndDownload = docs.find((d) => d.id === "pd-download")!
    expect(viewOnly.viewUrl).toBeTruthy()
    expect(viewOnly.downloadUrl).toBeNull()
    expect(viewAndDownload.downloadUrl).toBeTruthy()
  })

  it("scopes packet documents to the requested client's own packets only", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    packetDocumentFindMany.mockResolvedValue([])
    supportingDocumentFindMany.mockResolvedValue([])

    const { getPortalDocuments } = await import("@/lib/actions/portal-dashboard")
    await getPortalDocuments(CLIENT_ID)

    expect(packetDocumentFindMany.mock.calls[0][0].where.packet.clientId).toBe(CLIENT_ID)
    expect(supportingDocumentFindMany.mock.calls[0][0].where.clientId).toBe(CLIENT_ID)
  })
})

describe("getPortalCareTeam", () => {
  it("returns only client-facing fields, scoped to the requested client's own assignments", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    staffAssignmentFindMany.mockResolvedValue([
      { id: "sa-1", role: "case_manager", isPrimary: true, staff: { name: "Sarah Johnson", email: "sarah@northstar.com" } },
    ])

    const { getPortalCareTeam } = await import("@/lib/actions/portal-dashboard")
    const team = await getPortalCareTeam(CLIENT_ID)

    expect(staffAssignmentFindMany.mock.calls[0][0].where.clientId).toBe(CLIENT_ID)
    expect(team).toEqual([{ id: "sa-1", name: "Sarah Johnson", role: "Case Manager", email: "sarah@northstar.com", isPrimary: true }])
    // No internal staff metadata (passwordHash, isSuperAdmin, etc.) present.
    expect(Object.keys(team[0])).toEqual(["id", "name", "role", "email", "isPrimary"])
  })

  it("rejects a client with no active access grant", async () => {
    portalClientAccessFindFirst.mockResolvedValue(null)

    const { getPortalCareTeam } = await import("@/lib/actions/portal-dashboard")
    await expect(getPortalCareTeam(CLIENT_ID)).rejects.toThrow(/no active access/i)
  })
})

describe("getPortalDashboard — recent activity scoping", () => {
  it("only returns PortalAuditEvent rows for the authenticated user and the selected client (or client-less login events)", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockImplementation(async (args: any) => {
      if (args.select?.firstName) return { firstName: "Ayaan", lastName: "Mohamed", program: "Waiver", organization: { name: "North Star" } }
      return { organizationId: "org-1" }
    })
    packetFindFirst.mockResolvedValue(null)
    portalAuditEventFindMany.mockResolvedValue([{ id: "ev-1", action: "PORTAL_LOGIN_SUCCESS", createdAt: new Date() }])

    const { getPortalDashboard } = await import("@/lib/actions/portal-dashboard")
    await getPortalDashboard(CLIENT_ID)

    const where = portalAuditEventFindMany.mock.calls[0][0].where
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
    expect(where.OR).toEqual([{ clientId: CLIENT_ID }, { clientId: null }])
  })

  it("never exposes raw metadata, IP addresses, or user agents in recent activity — only a client-friendly description", async () => {
    portalClientAccessFindFirst.mockResolvedValue(activeAccess())
    clientFindUnique.mockImplementation(async (args: any) => {
      if (args.select?.firstName) return { firstName: "Ayaan", lastName: "Mohamed", program: "Waiver", organization: { name: "North Star" } }
      return { organizationId: "org-1" }
    })
    packetFindFirst.mockResolvedValue(null)
    portalAuditEventFindMany.mockResolvedValue([{ id: "ev-1", action: "PORTAL_LOGIN_SUCCESS", createdAt: new Date() }])

    const { getPortalDashboard } = await import("@/lib/actions/portal-dashboard")
    const dashboard = await getPortalDashboard(CLIENT_ID)

    expect(dashboard.recentActivity[0]).toEqual({ id: "ev-1", description: "You signed in", createdAt: expect.any(Date) })
    // The select clause itself never asks for metadata/ipAddress/userAgent/targetId.
    const selectFields = portalAuditEventFindMany.mock.calls[0][0].select
    expect(selectFields).toEqual({ id: true, action: true, createdAt: true })
  })
})

describe("getPortalNotifications", () => {
  it("only returns notifications belonging to the authenticated PortalUser", async () => {
    portalNotificationFindMany.mockResolvedValue([])
    const { getPortalNotifications } = await import("@/lib/actions/portal-dashboard")
    await getPortalNotifications()
    expect(portalNotificationFindMany.mock.calls[0][0].where.portalUserId).toBe(PORTAL_USER_ID)
  })
})

describe("getPortalAuthorizedClients — client switcher source", () => {
  it("only lists active, non-revoked, non-expired grants for this PortalUser", async () => {
    portalClientAccessFindMany.mockResolvedValue([
      { client: { id: "c1", firstName: "Ayaan", lastName: "Mohamed" }, relationship: "Mother", accessRole: "GUARDIAN" },
    ])
    const { getPortalAuthorizedClients } = await import("@/lib/actions/portal-dashboard")
    await getPortalAuthorizedClients()

    const where = portalClientAccessFindMany.mock.calls[0][0].where
    expect(where.portalUserId).toBe(PORTAL_USER_ID)
    expect(where.status).toBe("ACTIVE")
    expect(where.revokedAt).toBeNull()
  })
})
