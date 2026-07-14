"use server"

import { revalidatePath } from "next/cache"
import { UserRole } from "@prisma/client"
import { prisma } from "@/lib/db"
import { ORGANIZATION_WIDE_CLIENT_ROLES, requireClientAccess, requireOrganizationRole } from "@/lib/live-authorization"
import { requirePortalClientAccess } from "@/lib/portal/auth"
import { createAuditEvent } from "@/lib/audit"
import { notifyActivePortalUsersForClient } from "@/lib/portal/notifications"
import { validate, createPortalDocumentRequestSchema, reviewPortalDocumentRequestSchema } from "@/lib/validation"

// Matches documents.ts's EDIT_ROLES — requesting a document from a client is
// a routine document-management task, same tier as editing/sharing one.
const MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

// Stricter than MANAGE_ROLES — matches the tier that already manages portal
// access grants themselves (portal-invitations.ts's requireStaffManager),
// since enabling upload permission is a portal-access decision, not a
// routine document-management one.
const PERMISSION_MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

type ActionResult<T = Record<string, unknown>> = { success: true; data: T } | { success: false; error: string }

export async function createPortalDocumentRequest(raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createPortalDocumentRequestSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  try {
    // Client ownership verified server-side — never trust clientId beyond
    // deriving the target organization and assignment scope from it.
    const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true, organizationId: true } })
    if (!client) return { success: false, error: "Client not found" }
    const authorization = await requireClientAccess(client.id, "manage", "create portal document request")
    const orgId = authorization.organizationId

    if (data.packetId) {
      const packet = await prisma.packet.findUnique({ where: { id: data.packetId }, select: { clientId: true, organizationId: true } })
      if (!packet || packet.organizationId !== orgId || packet.clientId !== data.clientId) {
        return { success: false, error: "Packet not found" }
      }
    }
    if (data.packetDocumentId) {
      const packetDocument = await prisma.packetDocument.findUnique({
        where: { id: data.packetDocumentId },
        select: { packetId: true, packet: { select: { clientId: true, organizationId: true } } },
      })
      if (!packetDocument || packetDocument.packet.organizationId !== orgId || packetDocument.packet.clientId !== data.clientId) {
        return { success: false, error: "Document not found" }
      }
    }

    const request = await prisma.$transaction(async (tx) => {
      // Guard against two active requests targeting the same PacketDocument —
      // would double-count completion and create conflicting review outcomes.
      // Not a DB-level unique constraint (that can't safely express "only
      // among non-terminal statuses"), so this check + create is wrapped in a
      // transaction to narrow the race window as much as application-level
      // validation can.
      if (data.packetDocumentId) {
        const activeConflict = await tx.portalDocumentRequest.findFirst({
          where: { packetDocumentId: data.packetDocumentId, status: { in: ["PENDING", "SUBMITTED", "UNDER_REVIEW", "NEEDS_REPLACEMENT"] } },
          select: { id: true },
        })
        if (activeConflict) {
          throw new Error("Another active request already targets this document")
        }
      }

      return tx.portalDocumentRequest.create({
        data: {
          organizationId: orgId,
          clientId: data.clientId,
          packetId: data.packetId || null,
          packetDocumentId: data.packetDocumentId || null,
          title: data.title,
          description: data.description || null,
          category: data.category,
          priority: data.priority,
          isRequired: data.isRequired,
          dueDate: data.dueDate ? new Date(data.dueDate) : null,
          requestedByUserId: authorization.userId,
        },
      })
    })

    await createAuditEvent({
      organizationId: orgId,
      actorId: authorization.userId,
      action: "PORTAL_DOCUMENT_REQUEST_CREATED",
      targetType: "portal_document_request",
      targetId: request.id,
      metadata: { clientId: data.clientId, category: data.category, priority: data.priority, isRequired: data.isRequired },
    })

    await prisma.portalDocumentTimelineEvent.create({
      data: { requestId: request.id, eventType: "REQUESTED", createdByUserId: authorization.userId },
    })

    await notifyActivePortalUsersForClient({
      organizationId: orgId,
      clientId: data.clientId,
      type: "document_request",
      title: "New document requested",
      message: "Your care team has requested a document. Please review and upload.",
      link: `/portal/upload?client=${data.clientId}&request=${request.id}`,
      metadata: { requestId: request.id, clientId: data.clientId, event: "document_request" },
    })

    revalidatePath(`/clients/${data.clientId}/portal-access`)

    return { success: true, data: { id: request.id } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to create document request" }
  }
}

export async function cancelPortalDocumentRequest(requestId: string, reason?: string): Promise<ActionResult<{ id: string }>> {
  try {
    const request = await prisma.portalDocumentRequest.findUnique({ where: { id: requestId } })
    if (!request) return { success: false, error: "Request not found" }
    const authorization = await requireClientAccess(request.clientId, "manage", "cancel portal document request")
    if (authorization.organizationId !== request.organizationId) return { success: false, error: "Request not found" }
    const orgId = authorization.organizationId
    if (request.status === "CANCELLED") {
      return { success: false, error: "Request is already cancelled" }
    }
    if (request.status === "APPROVED") {
      return { success: false, error: "Cannot cancel a request that has already been approved" }
    }

    await prisma.portalDocumentRequest.update({
      where: { id: requestId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelledByUserId: authorization.userId, cancellationReason: reason || null },
    })

    await createAuditEvent({
      organizationId: orgId,
      actorId: authorization.userId,
      action: "PORTAL_DOCUMENT_REQUEST_CANCELLED",
      targetType: "portal_document_request",
      targetId: requestId,
      metadata: { reason: reason || null },
    })

    await prisma.portalDocumentTimelineEvent.create({
      data: { requestId, eventType: "CANCELLED", createdByUserId: authorization.userId, note: reason || null },
    })

    revalidatePath(`/clients/${request.clientId}/portal-access`)

    return { success: true, data: { id: requestId } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to cancel document request" }
  }
}

export async function getPortalDocumentRequests(orgId: string, clientId?: string) {
  const authorization = clientId
    ? await requireClientAccess(clientId, "manage", "list portal document requests")
    : await requireOrganizationRole(orgId, MANAGE_ROLES, "list portal document requests")
  if (authorization.organizationId !== orgId) throw new Error("Access denied")
  const now = new Date()
  const assignmentScope = !clientId && !ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role)
    ? {
        client: {
          assignments: {
            some: {
              staffUserId: authorization.userId,
              AND: [
                { OR: [{ startDate: null }, { startDate: { lte: now } }] },
                { OR: [{ endDate: null }, { endDate: { gt: now } }] },
              ],
            },
          },
        },
      }
    : {}
  return prisma.portalDocumentRequest.findMany({
    where: { organizationId: orgId, ...(clientId ? { clientId } : {}), ...assignmentScope },
    include: {
      requestedBy: { select: { id: true, name: true, email: true } },
      supportingDocuments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, originalFileName: true, fileSize: true, mimeType: true, reviewStatus: true, createdAt: true },
      },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  })
}

// ── Staff: enable/disable upload permission on an existing access grant ──
// Uploading is treated as lower-risk than signing — the client/guardian is
// submitting their own information, not authorizing a legal act on someone
// else's behalf — so this does not require PortalAccessAuthorization
// (legal-authority capture) the way canSignDocuments would. This action
// only ever touches canUploadDocuments; it never modifies canSignDocuments
// or canManageOtherGuardians.
export async function setPortalUploadPermission(accessId: string, enabled: boolean): Promise<ActionResult<{ id: string; canUploadDocuments: boolean }>> {
  try {
    const access = await prisma.portalClientAccess.findUnique({ where: { id: accessId } })
    if (!access) return { success: false, error: "Access grant not found" }
    const authorization = await requireOrganizationRole(access.organizationId, PERMISSION_MANAGE_ROLES, "change portal upload permission")
    const orgId = authorization.organizationId

    const updated = await prisma.portalClientAccess.update({
      where: { id: accessId },
      data: { canUploadDocuments: enabled },
    })

    await createAuditEvent({
      organizationId: orgId,
      actorId: authorization.userId,
      action: "PORTAL_ACCESS_UPLOAD_PERMISSION_CHANGED",
      targetType: "portal_client_access",
      targetId: accessId,
      metadata: { canUploadDocuments: enabled },
    })

    revalidatePath(`/clients/${access.clientId}/portal-access`)

    return { success: true, data: { id: accessId, canUploadDocuments: updated.canUploadDocuments } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to update upload permission" }
  }
}

export interface DocumentChecklistSummary {
  requiredTotal: number
  requiredCompleted: number
  remaining: number
  completionPercent: number
}

// ── Checklist: computed from PortalDocumentRequest rows only — optional
// (isRequired: false) and cancelled requests never count toward the total ──
async function computeChecklistSummary(clientId: string): Promise<DocumentChecklistSummary> {
  const [requiredTotal, requiredCompleted] = await Promise.all([
    prisma.portalDocumentRequest.count({ where: { clientId, isRequired: true, status: { not: "CANCELLED" } } }),
    prisma.portalDocumentRequest.count({ where: { clientId, isRequired: true, status: "APPROVED" } }),
  ])
  const remaining = requiredTotal - requiredCompleted
  const completionPercent = requiredTotal === 0 ? 0 : Math.round((requiredCompleted / requiredTotal) * 100)
  return { requiredTotal, requiredCompleted, remaining, completionPercent }
}

// ── Portal: checklist summary for the authenticated user's selected client ──
export async function getPortalUploadChecklist(clientId: string): Promise<DocumentChecklistSummary> {
  await requirePortalClientAccess(clientId)
  return computeChecklistSummary(clientId)
}

// ── Staff: checklist summary scoped to the active organization ──
export async function getStaffDocumentChecklist(orgId: string, clientId: string): Promise<DocumentChecklistSummary> {
  const authorization = await requireClientAccess(clientId, "read", "view portal document checklist")
  if (authorization.organizationId !== orgId) throw new Error("Client not found")
  return computeChecklistSummary(clientId)
}

// ── Portal: list requests for the currently-selected, access-verified client ──
export async function getPortalDocumentRequestsForClient(clientId: string) {
  await requirePortalClientAccess(clientId)
  return prisma.portalDocumentRequest.findMany({
    where: { clientId, status: { not: "CANCELLED" } },
    select: {
      id: true, title: true, description: true, category: true, priority: true,
      isRequired: true, dueDate: true, status: true, createdAt: true,
      supportingDocuments: {
        orderBy: { createdAt: "desc" },
        select: { id: true, originalFileName: true, fileSize: true, mimeType: true, reviewStatus: true, createdAt: true },
      },
    },
    orderBy: [{ status: "asc" }, { dueDate: "asc" }],
  })
}

// ── Portal: client-visible reviewer feedback for a single request ──
export async function getPortalDocumentReviewFeedback(requestId: string) {
  const request = await prisma.portalDocumentRequest.findUnique({ where: { id: requestId }, select: { clientId: true } })
  if (!request) throw new Error("Request not found")
  await requirePortalClientAccess(request.clientId)

  return prisma.portalDocumentReviewFeedback.findMany({
    where: { requestId },
    orderBy: { createdAt: "asc" },
    select: { id: true, note: true, category: true, severity: true, createdAt: true },
  })
}

// ── Portal: prior upload attempts + lifecycle events for a single request ──
export async function getPortalDocumentRequestHistory(requestId: string) {
  const request = await prisma.portalDocumentRequest.findUnique({ where: { id: requestId }, select: { clientId: true } })
  if (!request) throw new Error("Request not found")
  await requirePortalClientAccess(request.clientId)

  return prisma.portalDocumentTimelineEvent.findMany({
    where: { requestId },
    orderBy: { createdAt: "asc" },
    select: { id: true, eventType: true, note: true, createdAt: true },
  })
}

async function getLatestSupportingDocument(requestId: string) {
  return prisma.supportingDocument.findFirst({
    where: { portalRequestId: requestId },
    orderBy: { createdAt: "desc" },
  })
}

// ── Staff: SUBMITTED → UNDER_REVIEW (informational — signals a reviewer is looking at it) ──
export async function markPortalDocumentUnderReview(requestId: string): Promise<ActionResult<{ id: string }>> {
  try {
    const request = await prisma.portalDocumentRequest.findUnique({ where: { id: requestId } })
    if (!request) return { success: false, error: "Request not found" }
    const authorization = await requireClientAccess(request.clientId, "manage", "start portal document review")
    if (authorization.organizationId !== request.organizationId) return { success: false, error: "Request not found" }
    const orgId = authorization.organizationId
    if (request.status !== "SUBMITTED") {
      return { success: false, error: "Review can only be started from a Submitted request" }
    }

    const latestUpload = await getLatestSupportingDocument(requestId)
    if (!latestUpload) {
      return { success: false, error: "This request has no uploaded document to review" }
    }

    await prisma.$transaction(async (tx) => {
      await tx.portalDocumentRequest.update({ where: { id: requestId }, data: { status: "UNDER_REVIEW" } })
      await tx.supportingDocument.update({ where: { id: latestUpload.id }, data: { reviewStatus: "UNDER_REVIEW" } })
      await tx.portalDocumentTimelineEvent.create({
        data: { requestId, eventType: "UNDER_REVIEW", supportingDocumentId: latestUpload.id, createdByUserId: authorization.userId },
      })
    })

    await createAuditEvent({
      organizationId: orgId,
      actorId: authorization.userId,
      action: "PORTAL_DOCUMENT_REQUEST_UNDER_REVIEW",
      targetType: "portal_document_request",
      targetId: requestId,
      metadata: { supportingDocumentId: latestUpload.id },
    })

    revalidatePath(`/clients/${request.clientId}/portal-access`)

    return { success: true, data: { id: requestId } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to start review" }
  }
}

// ── Staff: SUBMITTED/UNDER_REVIEW → APPROVED | NEEDS_REPLACEMENT ──
export async function reviewPortalDocumentRequest(requestId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string; status: string }>> {
  const parsed = validate(reviewPortalDocumentRequestSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  try {
    const request = await prisma.portalDocumentRequest.findUnique({ where: { id: requestId } })
    if (!request) return { success: false, error: "Request not found" }
    const authorization = await requireClientAccess(request.clientId, "manage", "review portal document request")
    if (authorization.organizationId !== request.organizationId) return { success: false, error: "Request not found" }
    const orgId = authorization.organizationId
    if (request.status !== "SUBMITTED" && request.status !== "UNDER_REVIEW") {
      return { success: false, error: "This request cannot be reviewed in its current state" }
    }

    const latestUpload = await getLatestSupportingDocument(requestId)
    if (!latestUpload) {
      return { success: false, error: "This request has no uploaded document to review" }
    }

    const note = (data.note || "").trim()
    const hasFeedback = note.length > 0

    await prisma.$transaction(async (tx) => {
      await tx.portalDocumentRequest.update({ where: { id: requestId }, data: { status: data.decision } })
      await tx.supportingDocument.update({ where: { id: latestUpload.id }, data: { reviewStatus: data.decision } })
      await tx.portalDocumentTimelineEvent.create({
        data: { requestId, eventType: data.decision, supportingDocumentId: latestUpload.id, createdByUserId: authorization.userId },
      })

      if (hasFeedback) {
        await tx.portalDocumentReviewFeedback.create({
          data: {
            requestId,
            supportingDocumentId: latestUpload.id,
            reviewerUserId: authorization.userId,
            note,
            category: data.category || "OTHER",
            severity: data.severity || (data.decision === "NEEDS_REPLACEMENT" ? "REQUIRED" : "SUGGESTED"),
          },
        })
        await tx.portalDocumentTimelineEvent.create({
          data: { requestId, eventType: "FEEDBACK_ADDED", supportingDocumentId: latestUpload.id, createdByUserId: authorization.userId },
        })
      }

      if (data.decision === "APPROVED") {
        // Bridge into the existing packet-completion system only when this
        // request explicitly targets a PacketDocument — ad-hoc requests
        // (no packetDocumentId) have nothing to mark complete. Re-verify
        // current ownership rather than trusting the FK stored at request
        // creation time (creation validates packetId/packetDocumentId
        // independently, so a stale/mismatched pairing is possible).
        if (request.packetDocumentId) {
          const packetDocument = await tx.packetDocument.findUnique({
            where: { id: request.packetDocumentId },
            select: { id: true, packetId: true, status: true, packet: { select: { clientId: true, organizationId: true } } },
          })
          const belongsToSameTenant =
            packetDocument !== null &&
            packetDocument.packet.organizationId === orgId &&
            packetDocument.packet.clientId === request.clientId &&
            (!request.packetId || packetDocument.packetId === request.packetId)

          if (belongsToSameTenant && packetDocument.status !== "completed") {
            await tx.packetDocument.update({
              where: { id: packetDocument.id },
              data: { status: "completed", completedAt: new Date() },
            })
            await createAuditEvent({
              organizationId: orgId,
              actorId: authorization.userId,
              action: "PACKET_DOCUMENT_COMPLETED_VIA_PORTAL",
              targetType: "packet_document",
              targetId: packetDocument.id,
              metadata: { requestId, packetDocumentId: packetDocument.id, supportingDocumentId: latestUpload.id, transition: "completed" },
            }, tx)
          }
        }

        await notifyActivePortalUsersForClient({
          organizationId: orgId,
          clientId: request.clientId,
          type: "upload_approved",
          title: "Document approved",
          message: "A document you submitted has been approved.",
          link: `/portal/documents?client=${request.clientId}`,
          metadata: { requestId, clientId: request.clientId, event: "upload_approved" },
        }, tx)
      } else {
        await notifyActivePortalUsersForClient({
          organizationId: orgId,
          clientId: request.clientId,
          type: "needs_replacement",
          title: "Replacement needed",
          message: "Your care team needs you to re-upload a document. Please check the details.",
          link: `/portal/upload?client=${request.clientId}&request=${requestId}`,
          metadata: { requestId, clientId: request.clientId, event: "needs_replacement" },
        }, tx)
      }
    })

    await createAuditEvent({
      organizationId: orgId,
      actorId: authorization.userId,
      action: "PORTAL_DOCUMENT_REQUEST_REVIEWED",
      targetType: "portal_document_request",
      targetId: requestId,
      metadata: { decision: data.decision, category: data.category || null, severity: data.severity || null, hasFeedback },
    })

    revalidatePath(`/clients/${request.clientId}/portal-access`)

    return { success: true, data: { id: requestId, status: data.decision } }
  } catch (error) {
    return { success: false, error: (error as Error).message || "Failed to review document request" }
  }
}
