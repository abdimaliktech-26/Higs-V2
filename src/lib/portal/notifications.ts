import { prisma } from "@/lib/db"

type NotifyClient = Pick<typeof prisma, "portalClientAccess" | "portalNotification">

export interface PortalNotifyInput {
  organizationId: string
  clientId: string
  type: string
  title: string
  message: string
  link: string
  /**
   * Only ever requestId/clientId/event-type/dueDate — never client names,
   * document titles, feedback text, PHI, raw tokens, IP addresses, or
   * internal audit metadata. Enforced by convention at every call site,
   * not by this helper, since the caller decides what's safe to pass.
   */
  metadata: Record<string, unknown>
}

/**
 * Fans a notification out to every currently active, non-expired,
 * non-revoked PortalClientAccess grant for a client — never to a grant
 * that's expired/suspended/revoked. Accepts an optional transaction client
 * so callers already inside prisma.$transaction (upload route, review
 * action) can pass `tx` and have the notification writes commit atomically
 * with the rest of the transaction.
 */
export async function notifyActivePortalUsersForClient(input: PortalNotifyInput, client: NotifyClient = prisma) {
  const grants = await client.portalClientAccess.findMany({
    where: {
      clientId: input.clientId,
      status: "ACTIVE",
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { portalUserId: true },
  })

  await Promise.all(
    grants.map((grant) =>
      client.portalNotification.create({
        data: {
          organizationId: input.organizationId,
          portalUserId: grant.portalUserId,
          clientId: input.clientId,
          type: input.type,
          title: input.title,
          message: input.message,
          link: input.link,
          metadata: input.metadata as any,
        },
      })
    )
  )
}

/** Notifies exactly one portal user — used for the upload-received confirmation. */
export async function notifySinglePortalUser(portalUserId: string, input: PortalNotifyInput, client: NotifyClient = prisma) {
  await client.portalNotification.create({
    data: {
      organizationId: input.organizationId,
      portalUserId,
      clientId: input.clientId,
      type: input.type,
      title: input.title,
      message: input.message,
      link: input.link,
      metadata: input.metadata as any,
    },
  })
}
