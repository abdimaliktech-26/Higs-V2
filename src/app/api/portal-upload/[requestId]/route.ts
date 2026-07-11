import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { storeFile } from "@/lib/storage"
import { limiters } from "@/lib/rate-limit"
import { requirePortalAuth, requirePortalPermission, PortalAuthError } from "@/lib/portal/auth"
import { createPortalAuditEvent } from "@/lib/audit"
import { notifySinglePortalUser } from "@/lib/portal/notifications"
import { validateUploadFile, sanitizeFileName } from "@/lib/portal/upload-validation"

const UPLOADABLE_STATUSES = ["PENDING", "NEEDS_REPLACEMENT"] as const

function getExtension(fileName: string): string {
  const parts = fileName.toLowerCase().split(".")
  return parts.length > 1 ? `.${parts[parts.length - 1]}` : ""
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ requestId: string }> }) {
  const { requestId } = await params

  let portalUserId: string
  try {
    const auth = await requirePortalAuth()
    portalUserId = auth.portalUserId
  } catch (error) {
    if (error instanceof PortalAuthError) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const forwardedFor = req.headers.get("x-forwarded-for")
  const ip = forwardedFor ? forwardedFor.split(",")[0].trim() : req.headers.get("x-real-ip")?.trim() || "unknown"
  const rl = limiters.portalUpload.check(`${portalUserId}:${ip}`)
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many uploads. Try again in ${rl.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    )
  }

  // The request row (and therefore its clientId/organizationId) is the
  // source of truth — requestId from the URL is never trusted beyond
  // looking up this row; clientId/organizationId are never accepted from
  // the request body at all.
  const request = await prisma.portalDocumentRequest.findUnique({ where: { id: requestId } })
  if (!request) {
    return NextResponse.json({ success: false, error: "Request not found" }, { status: 404 })
  }

  try {
    await requirePortalPermission(request.clientId, "canUploadDocuments")
  } catch {
    return NextResponse.json({ success: false, error: "You do not have permission to upload for this request" }, { status: 403 })
  }

  if (!UPLOADABLE_STATUSES.includes(request.status as (typeof UPLOADABLE_STATUSES)[number])) {
    return NextResponse.json({ success: false, error: "This request cannot accept an upload right now" }, { status: 409 })
  }

  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateUploadFile({ fileName: file.name, declaredMimeType: file.type, buffer })
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }

  const originalFileName = sanitizeFileName(file.name)
  const ext = getExtension(originalFileName)
  const generatedId = crypto.randomUUID()
  const storageKey = `portal-uploads/${request.organizationId}/${request.clientId}/${requestId}/${generatedId}${ext}`

  let record
  try {
    record = await storeFile(storageKey, buffer, file.type, originalFileName)
  } catch {
    return NextResponse.json({ success: false, error: "Failed to store file" }, { status: 400 })
  }

  const eventType = request.status === "NEEDS_REPLACEMENT" ? "RESUBMITTED" : "UPLOADED"

  try {
    const supportingDocumentId = await prisma.$transaction(async (tx) => {
      // Conditional update prevents a race where two uploads for the same
      // request both succeed — only the first commits the SUBMITTED
      // transition; a concurrent second attempt sees count !== 1 and aborts.
      const updateResult = await tx.portalDocumentRequest.updateMany({
        where: { id: requestId, status: { in: ["PENDING", "NEEDS_REPLACEMENT"] } },
        data: { status: "SUBMITTED" },
      })
      if (updateResult.count !== 1) {
        throw new Error("This request cannot accept an upload right now")
      }

      const supportingDocument = await tx.supportingDocument.create({
        data: {
          organizationId: request.organizationId,
          clientId: request.clientId,
          packetId: request.packetId,
          title: request.title,
          category: request.category.toLowerCase(),
          fileUrl: record.url,
          fileKey: record.key,
          fileSize: record.size,
          mimeType: file.type,
          originalFileName,
          portalRequestId: requestId,
          uploadedByPortalUserId: portalUserId,
          status: "active",
          // Only ever set for portal-request uploads (this route) — staff
          // uploads elsewhere never touch reviewStatus, leaving it null.
          reviewStatus: "PENDING_REVIEW",
        },
      })

      await tx.portalDocumentTimelineEvent.create({
        data: {
          requestId,
          eventType,
          supportingDocumentId: supportingDocument.id,
          createdByPortalUserId: portalUserId,
        },
      })

      await createPortalAuditEvent({
        organizationId: request.organizationId,
        clientId: request.clientId,
        portalUserId,
        action: "PORTAL_DOCUMENT_UPLOADED",
        targetType: "portal_document_request",
        targetId: requestId,
        metadata: {
          requestId,
          supportingDocumentId: supportingDocument.id,
          fileSize: record.size,
          mimeType: file.type,
          eventType,
        },
      }, tx)

      await notifySinglePortalUser(portalUserId, {
        organizationId: request.organizationId,
        clientId: request.clientId,
        type: "upload_received",
        title: "Upload received",
        message: "We received your uploaded document. It's now pending review.",
        link: `/portal/upload?client=${request.clientId}&request=${requestId}`,
        metadata: { requestId, clientId: request.clientId, event: "upload_received" },
      }, tx)

      return supportingDocument.id
    })

    return NextResponse.json({ success: true, data: { supportingDocumentId, status: "SUBMITTED" } })
  } catch (error) {
    return NextResponse.json({ success: false, error: (error as Error).message || "Upload failed" }, { status: 409 })
  }
}
