"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import {
  CLIENT_READ_ROLES,
  ORGANIZATION_WIDE_CLIENT_ROLES,
  SIGNATURE_MANAGEMENT_ROLES,
  requireActiveOrganizationMembership,
  requireOrganizationRole,
} from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function getNotifications(orgId: string, params?: { type?: string; unreadOnly?: boolean; page?: number }) {
  const authorization = await requireActiveOrganizationMembership(orgId, "list notifications")
  const page = params?.page ?? 1; const pageSize = 50
  const where: Record<string, unknown> = { organizationId: orgId, userId: authorization.userId }

  if (params?.type) where.type = params.type
  if (params?.unreadOnly) where.readAt = null

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({
      where: where as any,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
    }),
    prisma.notification.count({ where: where as any }),
    prisma.notification.count({ where: { organizationId: orgId, userId: authorization.userId, readAt: null, dismissedAt: null } }),
  ])
  return { notifications, total, unreadCount, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function markNotificationRead(notificationId: string): Promise<ActionResult> {
  try {
    const n = await prisma.notification.findUnique({ where: { id: notificationId } })
    if (!n) return { success: false, error: "Not found" }
    const authorization = await requireActiveOrganizationMembership(n.organizationId, "mark notification read")
    if (n.userId !== authorization.userId) return { success: false, error: "Not found" }

    await prisma.notification.update({ where: { id: notificationId }, data: { readAt: new Date() } })

    await createAuditEvent({
      organizationId: n.organizationId, actorId: authorization.userId,
      action: "NOTIFICATION_MARKED_READ", targetType: "notification", targetId: notificationId,
    })

    revalidatePath("/notifications")
    return { success: true, data: { id: notificationId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function dismissNotification(notificationId: string): Promise<ActionResult> {
  try {
    const n = await prisma.notification.findUnique({ where: { id: notificationId } })
    if (!n) return { success: false, error: "Not found" }
    const authorization = await requireActiveOrganizationMembership(n.organizationId, "dismiss notification")
    if (n.userId !== authorization.userId) return { success: false, error: "Not found" }

    await prisma.notification.update({ where: { id: notificationId }, data: { dismissedAt: new Date(), readAt: new Date() } })

    revalidatePath("/notifications")
    return { success: true, data: { id: notificationId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function generateNotifications(orgId: string) {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "generate notifications")
  const role = authorization.role
  const isAdmin = ORGANIZATION_WIDE_CLIENT_ROLES.includes(role)
  const actorId = authorization.userId

  const now = new Date()
  let count = 0
  const assignmentWhere = {
    some: {
      staffUserId: actorId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    },
  }
  const clientScope = isAdmin ? {} : { client: { assignments: assignmentWhere } }

  // Overdue packet alerts
  const overduePackets = await prisma.packet.findMany({
    where: { organizationId: orgId, dueDate: { lt: now }, status: { notIn: ["approved", "archived"] }, ...clientScope },
    include: { client: { select: { firstName: true, lastName: true } } },
    take: 20,
  })

  for (const pkt of overduePackets) {
    const existing = await prisma.notification.findFirst({
      where: { organizationId: orgId, userId: actorId, type: "overdue", metadata: { path: ["packetId"], equals: pkt.id } },
    })
    if (!existing) {
      await prisma.notification.create({
        data: {
          organizationId: orgId, userId: actorId, type: "overdue",
          title: "Packet Overdue",
          message: `Packet for ${pkt.client.firstName} ${pkt.client.lastName} is overdue (due ${pkt.dueDate?.toLocaleDateString()})`,
          link: `/packets/${pkt.id}`,
          metadata: { packetId: pkt.id },
        },
      })
      count++
    }
  }

  // Validation failures
  if (isAdmin) {
    const failedValidations = await prisma.validationResult.findMany({
      where: { packet: { organizationId: orgId }, criticalCount: { gt: 0 } },
      include: { packet: { include: { client: { select: { firstName: true, lastName: true } } } } },
      orderBy: { ranAt: "desc" }, take: 10,
    })

    for (const v of failedValidations) {
      const existing = await prisma.notification.findFirst({
        where: { organizationId: orgId, userId: actorId, type: "validation_failure", metadata: { path: ["resultId"], equals: v.id } },
      })
      if (!existing) {
        const client = v.packet?.client
        await prisma.notification.create({
          data: {
            organizationId: orgId, userId: actorId, type: "validation_failure",
            title: "Validation Failed",
            message: `${v.criticalCount} critical issue${v.criticalCount > 1 ? "s" : ""} found for ${client?.firstName} ${client?.lastName}`,
            link: `/validation/${v.id}`,
            metadata: { resultId: v.id, packetId: v.packetId, criticalCount: v.criticalCount },
          },
        })
        count++
      }
    }
  }

  // Pending signatures
  const pendingSigs = SIGNATURE_MANAGEMENT_ROLES.includes(role)
    ? await prisma.signatureRequest.findMany({
        where: { organizationId: orgId, status: { in: ["pending", "sent"] }, ...(isAdmin ? {} : { packet: clientScope }) },
        include: { packet: { include: { client: { select: { firstName: true, lastName: true } } } } },
        take: 10,
      })
    : []

  for (const sig of pendingSigs) {
    const existing = await prisma.notification.findFirst({
      where: { organizationId: orgId, userId: actorId, type: "pending_signature", metadata: { path: ["requestId"], equals: sig.id } },
    })
    if (!existing) {
      const client = sig.packet?.client
      await prisma.notification.create({
        data: {
          organizationId: orgId, userId: actorId, type: "pending_signature",
          title: "Signature Pending",
          message: `Signature needed from ${sig.signerName} for ${client?.firstName} ${client?.lastName}`,
          link: `/signatures/${sig.id}`,
          metadata: { requestId: sig.id, signerName: sig.signerName },
        },
      })
      count++
    }
  }

  // Pending approvals
  if (isAdmin) {
    const pendingApprovals = await prisma.approvalRequest.findMany({
      where: { organizationId: orgId, status: "pending" },
      include: { packet: { include: { client: { select: { firstName: true, lastName: true } } } } },
      take: 10,
    })

    for (const ap of pendingApprovals) {
      const existing = await prisma.notification.findFirst({
        where: { organizationId: orgId, userId: actorId, type: "pending_approval", metadata: { path: ["requestId"], equals: ap.id } },
      })
      if (!existing) {
        const client = ap.packet?.client
        await prisma.notification.create({
          data: {
            organizationId: orgId, userId: actorId, type: "pending_approval",
            title: "Approval Pending",
            message: `Packet for ${client?.firstName} ${client?.lastName} is awaiting approval`,
            link: `/approvals/${ap.id}`,
            metadata: { requestId: ap.id, packetId: ap.packetId },
          },
        })
        count++
      }
    }
  }

  revalidatePath("/notifications")
  return { success: true as const, data: { generated: count } }
}
