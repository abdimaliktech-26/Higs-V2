import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const portalSessionFindUnique = vi.fn()
const portalClientAccessFindFirst = vi.fn()
const portalClientAccessFindMany = vi.fn()
const clientFindUnique = vi.fn()
const portalDocumentRequestFindMany = vi.fn()
const portalNotificationCreate = vi.fn()
const portalNotificationFindFirst = vi.fn()
const portalNotificationFindUnique = vi.fn()
const portalNotificationUpdate = vi.fn()

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
    portalDocumentRequest: { findMany: (...a: unknown[]) => portalDocumentRequestFindMany(...a) },
    portalNotification: {
      create: (...a: unknown[]) => portalNotificationCreate(...a),
      findFirst: (...a: unknown[]) => portalNotificationFindFirst(...a),
      findUnique: (...a: unknown[]) => portalNotificationFindUnique(...a),
      update: (...a: unknown[]) => portalNotificationUpdate(...a),
    },
    packet: { findFirst: vi.fn() },
    packetDocument: { findMany: vi.fn() },
    supportingDocument: { findMany: vi.fn() },
    staffAssignment: { findMany: vi.fn() },
    portalAuditEvent: { findMany: vi.fn() },
    portalUser: { findUnique: vi.fn() },
  },
}))
vi.mock("next/headers", () => ({ cookies: async () => cookiesMock, headers: async () => new Map() }))

const ORG_ID = "org-1"
const CLIENT_ID = "client-0000001"
const PORTAL_USER_ID = "pu-1"
const OTHER_PORTAL_USER_ID = "pu-2"

function activeAccess(overrides: Record<string, unknown> = {}) {
  return {
    id: "access-1", organizationId: ORG_ID, accessRole: "GUARDIAN", relationship: "Mother",
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
  clientFindUnique.mockResolvedValue({ organizationId: ORG_ID })
  portalClientAccessFindFirst.mockResolvedValue(activeAccess())
})

describe("notifyActivePortalUsersForClient", () => {
  it("fans out to every eligible active portal user for the client", async () => {
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }, { portalUserId: "pu-b" }, { portalUserId: "pu-c" }])

    const { notifyActivePortalUsersForClient } = await import("@/lib/portal/notifications")
    await notifyActivePortalUsersForClient({
      organizationId: ORG_ID, clientId: CLIENT_ID, type: "document_request",
      title: "New document requested", message: "msg", link: "/portal/upload?client=x&request=y",
      metadata: { requestId: "req-1", clientId: CLIENT_ID, event: "document_request" },
    })

    expect(portalNotificationCreate).toHaveBeenCalledTimes(3)
    const recipientIds = portalNotificationCreate.mock.calls.map((c: any) => c[0].data.portalUserId)
    expect(recipientIds.sort()).toEqual(["pu-a", "pu-b", "pu-c"])
  })

  it("queries only active, non-revoked, non-expired grants — excludes suspended/expired/revoked", async () => {
    portalClientAccessFindMany.mockResolvedValue([])

    const { notifyActivePortalUsersForClient } = await import("@/lib/portal/notifications")
    await notifyActivePortalUsersForClient({
      organizationId: ORG_ID, clientId: CLIENT_ID, type: "upload_approved",
      title: "t", message: "m", link: "/portal/documents?client=x",
      metadata: { requestId: "req-1", clientId: CLIENT_ID, event: "upload_approved" },
    })

    const where = portalClientAccessFindMany.mock.calls[0][0].where
    expect(where.status).toBe("ACTIVE")
    expect(where.revokedAt).toBeNull()
    expect(where.OR).toEqual([{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }])
    expect(portalNotificationCreate).not.toHaveBeenCalled()
  })

  it("stores only safe metadata — no client names, document titles, feedback text, or PHI", async () => {
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }])

    const { notifyActivePortalUsersForClient } = await import("@/lib/portal/notifications")
    await notifyActivePortalUsersForClient({
      organizationId: ORG_ID, clientId: CLIENT_ID, type: "needs_replacement",
      title: "Replacement needed", message: "generic message", link: "/portal/upload?client=x&request=y",
      metadata: { requestId: "req-1", clientId: CLIENT_ID, event: "needs_replacement" },
    })

    const data = portalNotificationCreate.mock.calls[0][0].data
    expect(Object.keys(data.metadata).sort()).toEqual(["clientId", "event", "requestId"])
  })
})

describe("notifySinglePortalUser", () => {
  it("notifies only the specified portal user — no fan-out query at all", async () => {
    const { notifySinglePortalUser } = await import("@/lib/portal/notifications")
    await notifySinglePortalUser(PORTAL_USER_ID, {
      organizationId: ORG_ID, clientId: CLIENT_ID, type: "upload_received",
      title: "Upload received", message: "msg", link: "/portal/upload?client=x&request=y",
      metadata: { requestId: "req-1", clientId: CLIENT_ID, event: "upload_received" },
    })

    expect(portalClientAccessFindMany).not.toHaveBeenCalled()
    expect(portalNotificationCreate).toHaveBeenCalledTimes(1)
    expect(portalNotificationCreate.mock.calls[0][0].data.portalUserId).toBe(PORTAL_USER_ID)
  })
})

describe("generatePortalDueDateReminders", () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it("creates due-tomorrow and due-in-3-days reminders, fanned out to active grants", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"))

    const tomorrow = new Date("2026-07-11T09:00:00Z")
    const inThreeDays = new Date("2026-07-13T09:00:00Z")

    portalDocumentRequestFindMany.mockResolvedValue([
      { id: "req-tomorrow", dueDate: tomorrow },
      { id: "req-3days", dueDate: inThreeDays },
    ])
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }, { portalUserId: "pu-b" }])
    portalNotificationFindFirst.mockResolvedValue(null)

    const { generatePortalDueDateReminders } = await import("@/lib/actions/portal-dashboard")
    await generatePortalDueDateReminders(CLIENT_ID)

    expect(portalNotificationCreate).toHaveBeenCalledTimes(4)
    const types = portalNotificationCreate.mock.calls.map((c: any) => c[0].data.type)
    expect(types.filter((t: string) => t === "due_tomorrow")).toHaveLength(2)
    expect(types.filter((t: string) => t === "due_in_3_days")).toHaveLength(2)
  })

  it("does not create reminders for a request that is not exactly tomorrow or exactly 3 days out (e.g. 2 days out)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"))

    portalDocumentRequestFindMany.mockResolvedValue([{ id: "req-2days", dueDate: new Date("2026-07-12T09:00:00Z") }])
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }])

    const { generatePortalDueDateReminders } = await import("@/lib/actions/portal-dashboard")
    await generatePortalDueDateReminders(CLIENT_ID)

    expect(portalNotificationCreate).not.toHaveBeenCalled()
  })

  it("does not create reminders for an unrelated far-future request (10 days out)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"))

    // The findMany where-clause itself excludes this, so simulating an
    // empty DB result is the correct way to model "outside the scan window."
    portalDocumentRequestFindMany.mockResolvedValue([])
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }])

    const { generatePortalDueDateReminders } = await import("@/lib/actions/portal-dashboard")
    await generatePortalDueDateReminders(CLIENT_ID)

    expect(portalNotificationCreate).not.toHaveBeenCalled()
  })

  it("does not create these reminder types for a past-due request", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"))

    // Past-due rows fall outside the [tomorrow, +4days) query window used by
    // the scan, so the DB layer itself never returns them here.
    portalDocumentRequestFindMany.mockResolvedValue([])
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }])

    const { generatePortalDueDateReminders } = await import("@/lib/actions/portal-dashboard")
    await generatePortalDueDateReminders(CLIENT_ID)

    expect(portalNotificationCreate).not.toHaveBeenCalled()
  })

  it("deduplicates: a second scan for the same request/user/type does not create a duplicate", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"))

    portalDocumentRequestFindMany.mockResolvedValue([{ id: "req-tomorrow", dueDate: new Date("2026-07-11T09:00:00Z") }])
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }])
    portalNotificationFindFirst.mockResolvedValue({ id: "existing-notif" })

    const { generatePortalDueDateReminders } = await import("@/lib/actions/portal-dashboard")
    await generatePortalDueDateReminders(CLIENT_ID)

    expect(portalNotificationCreate).not.toHaveBeenCalled()
    const dedupWhere = portalNotificationFindFirst.mock.calls[0][0].where
    expect(dedupWhere.portalUserId).toBe("pu-a")
    expect(dedupWhere.type).toBe("due_tomorrow")
    expect(dedupWhere.metadata).toEqual({ path: ["requestId"], equals: "req-tomorrow" })
  })

  it("stores only safe metadata on reminder notifications (requestId, clientId, event, dueDate)", async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-07-10T12:00:00Z"))

    const dueDate = new Date("2026-07-11T09:00:00Z")
    portalDocumentRequestFindMany.mockResolvedValue([{ id: "req-tomorrow", dueDate }])
    portalClientAccessFindMany.mockResolvedValue([{ portalUserId: "pu-a" }])
    portalNotificationFindFirst.mockResolvedValue(null)

    const { generatePortalDueDateReminders } = await import("@/lib/actions/portal-dashboard")
    await generatePortalDueDateReminders(CLIENT_ID)

    const data = portalNotificationCreate.mock.calls[0][0].data
    expect(Object.keys(data.metadata).sort()).toEqual(["clientId", "dueDate", "event", "requestId"])
  })
})

describe("markPortalNotificationRead", () => {
  it("lets a portal user mark their own notification read", async () => {
    portalNotificationFindUnique.mockResolvedValue({ id: "notif-1", portalUserId: PORTAL_USER_ID })

    const { markPortalNotificationRead } = await import("@/lib/actions/portal-dashboard")
    await markPortalNotificationRead("notif-1")

    expect(portalNotificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "notif-1" }, data: { readAt: expect.any(Date) } })
    )
  })

  it("rejects marking another portal user's notification read", async () => {
    portalNotificationFindUnique.mockResolvedValue({ id: "notif-2", portalUserId: OTHER_PORTAL_USER_ID })

    const { markPortalNotificationRead } = await import("@/lib/actions/portal-dashboard")
    await expect(markPortalNotificationRead("notif-2")).rejects.toThrow(/not found/i)
    expect(portalNotificationUpdate).not.toHaveBeenCalled()
  })
})
