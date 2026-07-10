"use server"

import { revalidatePath } from "next/cache"
import { validate } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"

const APPROVER_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
const SUBMITTER_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function submitForApproval(packetId: string): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const orgId = user.activeOrganizationId as string
    await requireOrgAccess(orgId)
    const role = getActiveRole(user as any)
    if (!SUBMITTER_ROLES.includes(role) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const packet = await prisma.packet.findUnique({ where: { id: packetId }, include: { documents: true } })
    if (!packet) return { success: false, error: "Packet not found" }

    const pendingSignatures = await prisma.signatureRequest.count({
      where: { packetId, status: { in: ["pending", "sent", "viewed"] } },
    })
    if (pendingSignatures > 0) {
      return { success: false, error: `${pendingSignatures} signature(s) still pending. Complete all signatures before submitting for approval.` }
    }

    const req = await prisma.approvalRequest.create({
      data: { organizationId: orgId, packetId, submittedById: user.id as string, status: "pending" },
    })

    await prisma.approvalEvent.create({
      data: { approvalRequestId: req.id, eventType: "submitted", createdById: user.id as string },
    })

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string,
      action: "APPROVAL_SUBMITTED", targetType: "approval_request", targetId: req.id,
      metadata: { packetId },
    })

    revalidatePath(`/packets/${packetId}`)
    revalidatePath("/approvals")
    return { success: true, data: { id: req.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function decideApproval(requestId: string, decision: "approved" | "rejected" | "changes_requested", notes?: string, correctionReason?: string): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const role = getActiveRole(user as any)
    if (!APPROVER_ROLES.includes(role) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const req = await prisma.approvalRequest.findUnique({
      where: { id: requestId }, include: { packet: { include: { documents: true } } },
    })
    if (!req) return { success: false, error: "Not found" }
    if (req.status !== "pending") return { success: false, error: `Request is already ${req.status}` }
    await requireOrgAccess(req.organizationId)

    await prisma.approvalRequest.update({
      where: { id: requestId },
      data: { status: decision, approverId: user.id as string, decisionNotes: notes || null, correctionReason: correctionReason || null, decidedAt: new Date() },
    })

    await prisma.approvalEvent.create({
      data: { approvalRequestId: requestId, eventType: decision, notes: notes || null, createdById: user.id as string },
    })

    // Update packet status
    if (decision === "approved") {
      await prisma.packet.update({ where: { id: req.packetId }, data: { status: "approved" } })
    } else {
      await prisma.packet.update({ where: { id: req.packetId }, data: { status: "validation_failed" } })
    }

    const auditMap: Record<string, string> = {
      approved: "APPROVAL_APPROVED", rejected: "APPROVAL_REJECTED", changes_requested: "APPROVAL_CHANGES_REQUESTED",
    }
    await createAuditEvent({
      organizationId: req.organizationId, actorId: user.id as string,
      action: auditMap[decision] as any, targetType: "approval_request", targetId: requestId,
      metadata: { packetId: req.packetId, notes },
    })

    revalidatePath(`/approvals/${requestId}`)
    revalidatePath(`/packets/${req.packetId}`)
    return { success: true, data: { id: requestId, status: decision } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function cancelApproval(requestId: string): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const req = await prisma.approvalRequest.findUnique({ where: { id: requestId } })
    if (!req) return { success: false, error: "Not found" }
    await requireOrgAccess(req.organizationId)

    await prisma.approvalRequest.update({ where: { id: requestId }, data: { status: "cancelled" } })
    await prisma.approvalEvent.create({ data: { approvalRequestId: requestId, eventType: "cancelled", createdById: user.id as string } })

    await createAuditEvent({
      organizationId: req.organizationId, actorId: user.id as string,
      action: "APPROVAL_CANCELLED", targetType: "approval_request", targetId: requestId,
    })

    revalidatePath("/approvals")
    return { success: true, data: { id: requestId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function getApprovalRequests(orgId: string, params?: { status?: string; packetId?: string; page?: number; pageSize?: number }) {
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.packetId) where.packetId = params.packetId

  const [requests, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where: where as any, orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        submittedBy: { select: { name: true } },
        approver: { select: { name: true } },
        packet: { select: { packetType: true, status: true, client: { select: { firstName: true, lastName: true } } } },
      },
    }),
    prisma.approvalRequest.count({ where: where as any }),
  ])
  return { requests, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getApprovalDetail(requestId: string) {
  const req = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      submittedBy: { select: { name: true, email: true } },
      approver: { select: { name: true, email: true } },
      packet: {
        include: {
          client: { select: { firstName: true, lastName: true, mcadId: true } },
          documents: { include: { documentTemplate: { select: { name: true } } } },
          validationResults: { orderBy: { ranAt: "desc" }, take: 1, select: { id: true, score: true, totalIssues: true } },
        },
      },
      events: { orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } },
    },
  })
  if (!req) return null
  await requireOrgAccess(req.organizationId)

  const pendingSignatures = await prisma.signatureRequest.count({
    where: { packetId: req.packetId, status: { in: ["pending", "sent", "viewed"] } },
  })
  const completedSignatures = await prisma.signatureRequest.count({
    where: { packetId: req.packetId, status: "signed" },
  })

  return { ...req, pendingSignatureCount: pendingSignatures, completedSignatureCount: completedSignatures }
}
