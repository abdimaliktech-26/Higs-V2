"use server"

import { revalidatePath } from "next/cache"
import { validate, createSignatureSchema } from "@/lib/validation"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { limiters, checkRateLimit } from "@/lib/rate-limit"

const REQUEST_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function createSignatureRequest(raw: Record<string, unknown>): Promise<ActionResult> {
  const parsed = validate(createSignatureSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const rl = checkRateLimit(limiters.signature, user.id as string)
    if (rl) return rl
    const orgId = user.activeOrganizationId as string
    await requireOrgAccess(orgId)
    if (!REQUEST_ROLES.includes(getActiveRole(user as any)) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const req = await prisma.signatureRequest.create({
      data: {
        organizationId: orgId, packetId: data.packetId || null,
        packetDocumentId: data.packetDocumentId || null, pdfFieldId: data.pdfFieldId || null,
        signerName: data.signerName, signerEmail: data.signerEmail,
        signerRole: data.signerRole, signerType: data.signerType,
        status: "pending", dueDate: data.dueDate ? new Date(data.dueDate) : null,
        consentText: data.consentText || null, notes: data.notes || null,
        requestedById: user.id as string,
      },
    })

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string,
      action: "SIGNATURE_REQUESTED", targetType: "signature_request", targetId: req.id,
      metadata: { signerName: data.signerName, signerEmail: data.signerEmail, packetId: data.packetId },
    })

    revalidatePath("/signatures")
    return { success: true, data: { id: req.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updateSignatureStatus(requestId: string, rawStatus: string, metadata?: Record<string, unknown>) {
  const statusParsed = validate(z.object({ status: z.enum(["pending","sent","viewed","signed","declined","cancelled"]) }), { status: rawStatus })
  if (!statusParsed.success) return { success: false as const, error: statusParsed.error }
  const { status } = statusParsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const req = await prisma.signatureRequest.findUnique({ where: { id: requestId } })
  if (!req) return { success: false as const, error: "Not found" }
  await requireOrgAccess(req.organizationId)

  const updateData: Record<string, unknown> = { status }
  if (status === "signed") updateData.signedAt = new Date()
  if (status === "declined" && metadata?.declineReason) updateData.declineReason = metadata.declineReason

  await prisma.signatureRequest.update({ where: { id: requestId }, data: updateData as any })

  await prisma.signatureEvent.create({
    data: { signatureRequestId: requestId, eventType: status, metadata: (metadata || {}) as any, createdById: user.id as string },
  })

  const actionMap: Record<string, string> = {
    sent: "SIGNATURE_SENT", viewed: "SIGNATURE_VIEWED", signed: "SIGNATURE_COMPLETED",
    declined: "SIGNATURE_DECLINED", cancelled: "SIGNATURE_CANCELLED",
  }
  const auditAction = actionMap[status]
  if (auditAction) {
    await createAuditEvent({
      organizationId: req.organizationId, actorId: user.id as string,
      action: auditAction as any, targetType: "signature_request", targetId: requestId,
      metadata: { signerName: req.signerName, ...metadata },
    })
  }

  revalidatePath("/signatures")
  return { success: true as const, data: { id: requestId, status } }
}

export async function getSignatureRequests(orgId: string, raw?: Record<string, unknown>) {
  const p = validate(z.object({ status: z.string().max(30).optional(), packetId: z.string().max(50).optional(), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(100).default(20) }), raw || {})
  const params = p.success ? p.data : { page: 1, pageSize: 20 }
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.packetId) where.packetId = params.packetId

  const [requests, total] = await Promise.all([
    prisma.signatureRequest.findMany({
      where: where as any, orderBy: { createdAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        requestedBy: { select: { name: true } },
        packet: { select: { packetType: true, status: true, client: { select: { firstName: true, lastName: true } } } },
        _count: { select: { events: true } },
      },
    }),
    prisma.signatureRequest.count({ where: where as any }),
  ])
  return { requests, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getSignatureDetail(requestId: string) {
  const req = await prisma.signatureRequest.findUnique({
    where: { id: requestId },
    include: {
      requestedBy: { select: { name: true, email: true } },
      packet: { include: { client: { select: { firstName: true, lastName: true, mcadId: true } } } },
      packetDocument: { include: { documentTemplate: { select: { name: true } } } },
      pdfField: { select: { name: true, fieldType: true, value: true } },
      events: { orderBy: { createdAt: "asc" }, include: { createdBy: { select: { name: true } } } },
    },
  })
  if (!req) return null
  await requireOrgAccess(req.organizationId)
  return req
}
