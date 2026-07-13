"use server"

import { prisma } from "@/lib/db"
import { requirePortalAuth, requirePortalClientAccess, requirePortalPermission } from "@/lib/portal/auth"
import { signPortalFileUrl } from "@/lib/storage"

const REMINDER_STATUSES = ["PENDING", "NEEDS_REPLACEMENT"] as const

function startOfDayOffset(daysFromNow: number): Date {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() + daysFromNow)
  return d
}

// ── Client switcher: only this PortalUser's own active grants ──
export async function getPortalAuthorizedClients() {
  const auth = await requirePortalAuth()
  const access = await prisma.portalClientAccess.findMany({
    where: {
      portalUserId: auth.portalUserId,
      status: "ACTIVE",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    include: { client: { select: { id: true, firstName: true, lastName: true } } },
    orderBy: { createdAt: "asc" },
  })
  return access.map((a) => ({
    clientId: a.client.id,
    displayName: `${a.client.firstName} ${a.client.lastName}`,
    relationship: a.relationship,
    accessRole: a.accessRole,
  }))
}

// ── Dashboard: welcome summary, current packet, completion, recent activity ──
export async function getPortalDashboard(clientId: string) {
  const context = await requirePortalClientAccess(clientId)

  const client = await prisma.client.findUnique({
    where: { id: clientId },
    select: {
      firstName: true, lastName: true, program: true,
      organization: { select: { name: true } },
    },
  })
  if (!client) throw new Error("Client not found")

  const packet = await prisma.packet.findFirst({
    where: { clientId, status: { not: "archived" } },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true, packetType: true, status: true, dueDate: true,
      documents: { select: { status: true, isRequired: true, applicabilityStatus: true } },
    },
  })

  let packetSummary: {
    id: string
    packetType: string
    status: string
    dueDate: Date | null
    completionPct: number
    requiredTotal: number
    requiredCompleted: number
  } | null = null

  if (packet) {
    // Step 4c.4c — a conditionally inactive document is not currently
    // applicable to this packet and must not count toward the client's own
    // completion summary, matching the persisted-column-only predicate
    // already shipped for the staff-facing packet overview in Step 4c.4a. No
    // condition-runtime evaluation is invoked here.
    const required = packet.documents.filter((d) => d.isRequired && d.applicabilityStatus !== "CONDITIONALLY_INACTIVE")
    const requiredCompleted = required.filter((d) => d.status === "completed").length
    const completionPct = required.length ? Math.round((requiredCompleted / required.length) * 100) : 0
    packetSummary = {
      id: packet.id, packetType: packet.packetType, status: packet.status, dueDate: packet.dueDate,
      completionPct, requiredTotal: required.length, requiredCompleted,
    }
  }

  const recentActivity = await prisma.portalAuditEvent.findMany({
    where: {
      portalUserId: context.portalUserId,
      OR: [{ clientId }, { clientId: null }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: { id: true, action: true, createdAt: true },
  })

  return {
    clientDisplayName: `${client.firstName} ${client.lastName}`,
    organizationName: client.organization.name,
    program: client.program,
    relationship: context.relationship,
    accessRole: context.accessRole,
    packet: packetSummary,
    recentActivity: recentActivity.map((e) => ({ id: e.id, description: describePortalActivity(e.action), createdAt: e.createdAt })),
  }
}

function describePortalActivity(action: string): string {
  const labels: Record<string, string> = {
    PORTAL_LOGIN_SUCCESS: "You signed in",
    PORTAL_LOGIN_FAILED: "A sign-in attempt failed",
    PORTAL_INVITATION_ACCEPTED: "You accepted a portal invitation",
    PORTAL_ACCESS_GRANTED: "Portal access was granted",
    PORTAL_ACCESS_REVOKED: "Portal access was removed",
    PORTAL_EMAIL_VERIFIED: "Your email was verified",
    PORTAL_SESSION_REVOKED: "You signed out",
    PORTAL_DOCUMENT_VIEWED: "You viewed a document",
    PORTAL_DOCUMENT_DOWNLOADED: "You downloaded a document",
  }
  return labels[action] || "Account activity"
}

// ── Documents: only portalVisible rows, gated on canViewDocuments ──
export interface PortalDocumentRow {
  id: string
  docType: "packet_document" | "supporting_document"
  title: string
  category: string | null
  status: string | null
  accessLevel: string
  updatedAt: Date
  viewUrl: string
  downloadUrl: string | null
}

export async function getPortalDocuments(clientId: string): Promise<PortalDocumentRow[]> {
  await requirePortalPermission(clientId, "canViewDocuments")

  const [packetDocs, supportingDocs] = await Promise.all([
    // Step 4c.4c — portal availability is portalVisible AND applicable
    // (persisted applicabilityStatus column only, no condition-runtime
    // evaluation) AND the existing permission/access checks above. Enforced
    // in the where clause rather than filtered in memory. Supporting
    // documents have no applicabilityStatus and are unaffected — they never
    // participate in the packet condition system.
    prisma.packetDocument.findMany({
      where: { portalVisible: true, applicabilityStatus: { not: "CONDITIONALLY_INACTIVE" }, packet: { clientId } },
      select: {
        id: true, status: true, updatedAt: true, portalAccessLevel: true,
        documentTemplate: { select: { name: true } },
      },
      orderBy: { updatedAt: "desc" },
    }),
    prisma.supportingDocument.findMany({
      where: { portalVisible: true, clientId },
      select: { id: true, title: true, category: true, status: true, updatedAt: true, portalAccessLevel: true },
      orderBy: { updatedAt: "desc" },
    }),
  ])

  const packetRows: PortalDocumentRow[] = packetDocs.map((d) => {
    const accessLevel = d.portalAccessLevel || "VIEW"
    return {
      id: d.id,
      docType: "packet_document",
      title: d.documentTemplate.name,
      category: null,
      status: d.status,
      accessLevel,
      updatedAt: d.updatedAt,
      viewUrl: signPortalFileUrl("packet_document", d.id, "view"),
      downloadUrl: accessLevel === "VIEW_AND_DOWNLOAD" ? signPortalFileUrl("packet_document", d.id, "download") : null,
    }
  })

  const supportingRows: PortalDocumentRow[] = supportingDocs.map((d) => {
    const accessLevel = d.portalAccessLevel || "VIEW"
    return {
      id: d.id,
      docType: "supporting_document",
      title: d.title,
      category: d.category,
      status: d.status,
      accessLevel,
      updatedAt: d.updatedAt,
      viewUrl: signPortalFileUrl("supporting_document", d.id, "view"),
      downloadUrl: accessLevel === "VIEW_AND_DOWNLOAD" ? signPortalFileUrl("supporting_document", d.id, "download") : null,
    }
  })

  return [...packetRows, ...supportingRows].sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime())
}

// ── Care team: real StaffAssignment rows, client-facing fields only ──
export async function getPortalCareTeam(clientId: string) {
  await requirePortalClientAccess(clientId)

  const assignments = await prisma.staffAssignment.findMany({
    where: { clientId, endDate: null },
    select: {
      id: true, role: true, isPrimary: true,
      staff: { select: { name: true, email: true } },
    },
    orderBy: [{ isPrimary: "desc" }],
  })

  return assignments.map((a) => ({
    id: a.id,
    name: a.staff.name || "Unnamed",
    role: a.role.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
    email: a.staff.email,
    isPrimary: a.isPrimary,
  }))
}

// ── Notifications: read-only, own PortalUser rows only ──
export async function getPortalNotifications() {
  const auth = await requirePortalAuth()
  return prisma.portalNotification.findMany({
    where: { portalUserId: auth.portalUserId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, type: true, title: true, message: true, link: true, readAt: true, createdAt: true },
  })
}

// ── Due-date reminders: deduplicated on-demand scan, triggered by page load ──
// No cron/background worker exists in this app — this runs synchronously
// whenever the portal dashboard or notifications page renders, and relies on
// a per-recipient dedup check (mirroring the staff generateNotifications
// JSON-path pattern) so repeated page loads never create duplicate reminders.
export async function generatePortalDueDateReminders(clientId: string): Promise<void> {
  const context = await requirePortalClientAccess(clientId)

  const reminderWindows: { type: string; start: Date; end: Date }[] = [
    { type: "due_tomorrow", start: startOfDayOffset(1), end: startOfDayOffset(2) },
    { type: "due_in_3_days", start: startOfDayOffset(3), end: startOfDayOffset(4) },
  ]

  const requests = await prisma.portalDocumentRequest.findMany({
    where: {
      clientId,
      status: { in: [...REMINDER_STATUSES] },
      dueDate: { gte: reminderWindows[0].start, lt: reminderWindows[1].end },
    },
    select: { id: true, dueDate: true },
  })
  if (requests.length === 0) return

  const grants = await prisma.portalClientAccess.findMany({
    where: {
      clientId,
      status: "ACTIVE",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { portalUserId: true },
  })
  if (grants.length === 0) return

  for (const request of requests) {
    if (!request.dueDate) continue
    const window = reminderWindows.find((w) => request.dueDate! >= w.start && request.dueDate! < w.end)
    if (!window) continue

    const title = window.type === "due_tomorrow" ? "Document due tomorrow" : "Document due in 3 days"
    const message =
      window.type === "due_tomorrow"
        ? "A requested document is due tomorrow. Please upload it soon."
        : "A requested document is due in 3 days. Please upload it soon."
    const link = `/portal/upload?client=${clientId}&request=${request.id}`

    for (const grant of grants) {
      const existing = await prisma.portalNotification.findFirst({
        where: {
          portalUserId: grant.portalUserId,
          clientId,
          type: window.type,
          metadata: { path: ["requestId"], equals: request.id },
        },
        select: { id: true },
      })
      if (existing) continue

      await prisma.portalNotification.create({
        data: {
          organizationId: context.organizationId,
          portalUserId: grant.portalUserId,
          clientId,
          type: window.type,
          title,
          message,
          link,
          metadata: { requestId: request.id, clientId, event: window.type, dueDate: request.dueDate.toISOString() },
        },
      })
    }
  }
}

// ── Mark own notification read — never another PortalUser's ──
export async function markPortalNotificationRead(notificationId: string): Promise<void> {
  const auth = await requirePortalAuth()

  const notification = await prisma.portalNotification.findUnique({
    where: { id: notificationId },
    select: { id: true, portalUserId: true },
  })
  if (!notification || notification.portalUserId !== auth.portalUserId) {
    throw new Error("Notification not found")
  }

  await prisma.portalNotification.update({
    where: { id: notificationId },
    data: { readAt: new Date() },
  })
}

// ── Settings/security summary: real, minimal ──
export async function getPortalSettings() {
  const auth = await requirePortalAuth()
  const portalUser = await prisma.portalUser.findUnique({
    where: { id: auth.portalUserId },
    select: { email: true, emailVerifiedAt: true, lastLoginAt: true },
  })
  if (!portalUser) throw new Error("Account not found")

  const session = await prisma.portalSession.findUnique({
    where: { id: auth.sessionId },
    select: { expires: true, createdAt: true, ipAtLogin: true },
  })

  return {
    email: portalUser.email,
    emailVerified: !!portalUser.emailVerifiedAt,
    lastLoginAt: portalUser.lastLoginAt,
    currentSession: session ? { expiresAt: session.expires, signedInAt: session.createdAt } : null,
  }
}
