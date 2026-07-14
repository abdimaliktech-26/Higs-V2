import { prisma } from "@/lib/db"
import { CLIENT_READ_ROLES, ORGANIZATION_WIDE_CLIENT_ROLES, requireOrganizationRole, requirePacketAccess } from "@/lib/live-authorization"

export interface FocusPacketContext {
  id: string
  status: string
  packetType: string
  dueDate: Date | null
  programName: string | null
  client: { id: string; firstName: string; lastName: string; mcadId: string | null }
  documentsTotal: number
  documentsCompleted: number
}

/**
 * Read-only lookup used to render the "Focused Notification" panel's
 * Client / Program / Packet / Progress fields. Mirrors the same
 * prisma.packet.findMany shape already used in generateNotifications
 * (src/lib/actions/notifications.ts) — no new business rules.
 */
export async function getNotificationFocusPacket(orgId: string, packetId: string | undefined): Promise<FocusPacketContext | null> {
  if (!packetId) return null
  const authorization = await requirePacketAccess(packetId, "read", "view notification packet context")
  if (authorization.organizationId !== orgId) return null
  const packet = await prisma.packet.findFirst({
    where: { id: packetId, organizationId: orgId },
    select: {
      id: true, status: true, packetType: true, dueDate: true,
      program: { select: { name: true } },
      client: { select: { id: true, firstName: true, lastName: true, mcadId: true } },
      documents: { select: { status: true } },
    },
  })
  if (!packet) return null

  return {
    id: packet.id,
    status: packet.status,
    packetType: packet.packetType,
    dueDate: packet.dueDate,
    programName: packet.program?.name ?? null,
    client: packet.client,
    documentsTotal: packet.documents.length,
    documentsCompleted: packet.documents.filter((d) => d.status === "completed").length,
  }
}

export interface UpcomingDeadline {
  packetId: string
  clientName: string
  packetType: string
  dueDate: Date
}

/**
 * Read-only lookup of packets due in the next 7 days (not yet overdue).
 * Mirrors the overdue-packet query already used in generateNotifications,
 * just with a future date window instead of a past one.
 */
export async function getUpcomingDeadlines(orgId: string, days = 7): Promise<UpcomingDeadline[]> {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "view upcoming packet deadlines")
  const now = new Date()
  const horizon = new Date(now.getTime() + days * 86400000)

  const packets = await prisma.packet.findMany({
    where: {
      organizationId: orgId,
      dueDate: { gte: now, lte: horizon },
      status: { notIn: ["approved", "archived"] },
      ...(!ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role) ? {
        client: { assignments: { some: {
          staffUserId: authorization.userId,
          AND: [
            { OR: [{ startDate: null }, { startDate: { lte: now } }] },
            { OR: [{ endDate: null }, { endDate: { gt: now } }] },
          ],
        } } },
      } : {}),
    },
    select: { id: true, packetType: true, dueDate: true, client: { select: { firstName: true, lastName: true } } },
    orderBy: { dueDate: "asc" },
    take: 10,
  })

  return packets.map((p) => ({
    packetId: p.id,
    clientName: `${p.client.firstName} ${p.client.lastName}`,
    packetType: p.packetType,
    dueDate: p.dueDate as Date,
  }))
}
