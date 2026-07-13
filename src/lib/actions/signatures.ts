"use server"

import { revalidatePath } from "next/cache"
import { headers } from "next/headers"
import { validate, createSignatureSchema } from "@/lib/validation"
import { z } from "zod"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { limiters, checkRateLimit } from "@/lib/rate-limit"
import { formatSignedFieldValue, normalizeSignerName, normalizeDisplayName } from "@/lib/actions/signature-formatting"

const REQUEST_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

// Step 5a.1 — the only approved role set for actually executing (not just
// requesting) a signature. Reuses REQUEST_ROLES' exact membership per the
// approved decision rather than inventing a narrower set without evidence
// one is needed.
const EXECUTION_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

// Statuses updateSignatureStatus (the generic, non-execution status action)
// may still set. "signed" is deliberately excluded at both the TypeScript
// and zod level — executeStaffSignature is the only path to "signed" as of
// Step 5a.1.
const NON_SIGNING_STATUSES = ["pending", "sent", "viewed", "declined", "cancelled"] as const
export type NonSigningStatus = (typeof NON_SIGNING_STATUSES)[number]

// Mirrors the existing getRequestMeta() pattern in src/lib/actions/portal-auth.ts
// (not exported there, so replicated locally) — first x-forwarded-for entry,
// falling back to x-real-ip, falling back to the same "unknown" sentinel
// already used by that convention. Never derived from anything the caller
// supplies.
async function getSignatureRequestMeta() {
  const hdrs = await headers()
  const forwardedFor = hdrs.get("x-forwarded-for")
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : hdrs.get("x-real-ip")?.trim() || "unknown"
  const userAgent = hdrs.get("user-agent")
  return { ip, userAgent }
}

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

// Step 5a.1 — "signed" is deliberately not a member of NonSigningStatus, so
// passing it is a TypeScript compile-time error at every call site, backed
// by the same restriction at the zod layer for any caller that bypasses
// static typing. executeStaffSignature (below) is the only approved path to
// "signed" as of this step.
export async function updateSignatureStatus(requestId: string, rawStatus: NonSigningStatus, metadata?: Record<string, unknown>) {
  const statusParsed = validate(z.object({ status: z.enum(NON_SIGNING_STATUSES) }), { status: rawStatus })
  if (!statusParsed.success) return { success: false as const, error: statusParsed.error }
  const { status } = statusParsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const req = await prisma.signatureRequest.findUnique({ where: { id: requestId } })
  if (!req) return { success: false as const, error: "Not found" }
  await requireOrgAccess(req.organizationId)

  const updateData: Record<string, unknown> = { status }
  if (status === "declined" && metadata?.declineReason) updateData.declineReason = metadata.declineReason

  await prisma.signatureRequest.update({ where: { id: requestId }, data: updateData as any })

  await prisma.signatureEvent.create({
    data: { signatureRequestId: requestId, eventType: status, metadata: (metadata || {}) as any, createdById: user.id as string },
  })

  const actionMap: Record<string, string> = {
    sent: "SIGNATURE_SENT", viewed: "SIGNATURE_VIEWED",
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

export interface ExecuteStaffSignatureResult {
  requestId: string
  status: "signed"
  signedAt: string
  remainingIncompleteSignatures: number
  allRequiredSignaturesComplete: boolean
}

// ── Step 5a.1 — Staff Signature Execution Foundation ──
//
// The only approved path to a "signed" SignatureRequest. Staff-self-
// signature only: the acting user must be the person named as signerEmail
// on the request — this does not support staff signing for a client,
// guardian, or a different staff member, recording an external signature,
// or any form of proxy/impersonated execution. Those are separately
// designed, out-of-scope workflows.
//
// Nothing about organization identity, packet/document/field relationships,
// current status, timestamp, IP, or user-agent is ever taken from the
// caller — all of it is loaded fresh or derived on the server, and the
// packet-document/field relationships are re-verified a second time inside
// the transaction rather than trusted from the pre-transaction read, per
// this codebase's existing saveDocumentFields convention.
export async function executeStaffSignature(
  requestId: string,
  input: { signerName: string; consentAccepted: boolean }
): Promise<{ success: true; data: ExecuteStaffSignatureResult } | { success: false; error: string }> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const actorId = user.id as string
    const rl = checkRateLimit(limiters.signature, actorId)
    if (rl) return rl
    const actorEmail = ((user.email as string) || "").trim().toLowerCase()

    const req = await prisma.signatureRequest.findUnique({
      where: { id: requestId },
      include: { packetDocument: { include: { packet: true } } },
    })
    if (!req) return { success: false, error: "Signature request not found" }

    await requireOrgAccess(req.organizationId)
    const role = getActiveRole(user as any)
    if (!EXECUTION_ROLES.includes(role) && !(user.isSuperAdmin as boolean)) {
      return { success: false, error: "Insufficient permissions" }
    }

    // Staff-self-signature identity check — the only authorization
    // mechanism available given signerRole/signerType are unstructured free
    // text with no reliable "this is a staff signer" flag.
    if (!req.signerEmail || !req.signerEmail.trim()) {
      return { success: false, error: "This request has no signer email on file and cannot be executed." }
    }
    if (req.signerEmail.trim().toLowerCase() !== actorEmail) {
      return { success: false, error: "You are not the signer named on this request." }
    }

    const typedName = (input.signerName || "").trim()
    if (!typedName) return { success: false, error: "Enter your name to sign." }
    if (normalizeSignerName(typedName) !== normalizeSignerName(req.signerName)) {
      return { success: false, error: "The name you entered does not match the signer name on this request." }
    }

    if (input.consentAccepted !== true) {
      return { success: false, error: "You must accept the consent statement to sign." }
    }
    if (!req.consentText || !req.consentText.trim()) {
      return { success: false, error: "This request has no consent language configured and cannot be signed yet." }
    }

    if (!req.packetDocumentId || !req.packetDocument) {
      return { success: false, error: "This request is not linked to a packet document." }
    }
    if (!req.pdfFieldId) {
      return { success: false, error: "This request is not linked to a signature field." }
    }
    if (req.packetDocument.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
      return { success: false, error: "This document is currently not applicable based on packet conditions and cannot be signed." }
    }
    if (req.packetDocument.packet.status === "approved" || req.packetDocument.packet.status === "archived") {
      return { success: false, error: "This document is approved and locked for editing." }
    }

    const { ip, userAgent } = await getSignatureRequestMeta()
    const signedAt = new Date()
    const packetDocumentId = req.packetDocumentId
    const pdfFieldId = req.pdfFieldId

    const txResult = await prisma.$transaction(async (tx) => {
      // Re-verify field ownership and type inside the transaction — never
      // trust the outer, pre-transaction read for this.
      const field = await tx.pdfField.findUnique({ where: { id: pdfFieldId } })
      if (!field || field.packetDocumentId !== packetDocumentId) {
        throw new Error("The linked signature field could not be verified.")
      }
      if (field.fieldType !== "signature") {
        throw new Error("The linked field is not a signature field.")
      }

      // Re-verify the document's organization, applicability, and lock
      // status inside the transaction too.
      const doc = await tx.packetDocument.findUnique({ where: { id: packetDocumentId }, include: { packet: true } })
      if (!doc || doc.packet.organizationId !== req.organizationId) {
        throw new Error("The linked document could not be verified.")
      }
      if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
        throw new Error("This document is currently not applicable based on packet conditions and cannot be signed.")
      }
      if (doc.packet.status === "approved" || doc.packet.status === "archived") {
        throw new Error("This document is approved and locked for editing.")
      }

      // The concurrency gate: only a request currently "sent" or "viewed"
      // transitions to "signed", and exactly one concurrent caller can ever
      // win this — a conditional update, never a read-then-write.
      const updateResult = await tx.signatureRequest.updateMany({
        where: { id: requestId, status: { in: ["sent", "viewed"] } },
        data: { status: "signed", signedAt, signedIp: ip, signedUserAgent: userAgent },
      })
      if (updateResult.count !== 1) {
        throw new Error("This signature request has already been completed.")
      }

      const fieldValue = formatSignedFieldValue(normalizeDisplayName(typedName), signedAt)
      await tx.pdfField.update({ where: { id: field.id }, data: { value: fieldValue } })

      await tx.signatureEvent.create({
        data: {
          signatureRequestId: requestId,
          eventType: "signed",
          ipAddress: ip,
          userAgent,
          createdById: actorId,
          metadata: { method: "staff_self_signature" },
        },
      })

      await createAuditEvent({
        organizationId: req.organizationId,
        actorId,
        action: "SIGNATURE_COMPLETED",
        targetType: "signature_request",
        targetId: requestId,
        ipAddress: ip,
        userAgent,
        metadata: { packetId: doc.packetId, packetDocumentId, signerName: req.signerName },
      }, tx)

      const remainingIncompleteSignatures = req.packetId
        ? await tx.signatureRequest.count({
            where: { packetId: req.packetId, status: { in: ["pending", "sent", "viewed"] } },
          })
        : 0

      return { remainingIncompleteSignatures }
    })

    revalidatePath("/signatures")
    revalidatePath(`/signatures/${requestId}`)

    return {
      success: true,
      data: {
        requestId,
        status: "signed",
        signedAt: signedAt.toISOString(),
        remainingIncompleteSignatures: txResult.remainingIncompleteSignatures,
        allRequiredSignaturesComplete: txResult.remainingIncompleteSignatures === 0,
      },
    }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
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
