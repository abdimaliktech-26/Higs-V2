import { NextRequest, NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { limiters } from "@/lib/rate-limit"
import { requirePortalAuth, requirePortalPermission, PortalAuthError } from "@/lib/portal/auth"
import { sanitizeFileName } from "@/lib/portal/upload-validation"
import { UploadLifecycleError } from "@/lib/uploads/errors"
import { assertUploadRuntimeAvailable, UploadRuntimeUnavailableError } from "@/lib/uploads/receipt"
import { initiatePortalUpload } from "@/lib/uploads/supporting-upload"

const UPLOADABLE_STATUSES = ["PENDING", "NEEDS_REPLACEMENT"] as const

// PR-5B.3: receipt ends at SCANNING. The SupportingDocument owner, request
// SUBMITTED transition, timeline event, audit, and notification are created
// only by the portal completion endpoint after a version-bound CLEAN result.
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

  // Fail before multipart parsing/byte acceptance when the operating gate is closed.
  try {
    assertUploadRuntimeAvailable()
  } catch (error) {
    if (error instanceof UploadRuntimeUnavailableError || (error instanceof Error && error.name.includes("Storage"))) {
      return NextResponse.json({ success: false, error: "Secure uploads are temporarily unavailable." }, { status: 503 })
    }
    throw error
  }

  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  try {
    const result = await initiatePortalUpload({
      organizationId: request.organizationId,
      clientId: request.clientId,
      packetId: request.packetId,
      portalUserId,
      requestId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      originalFileName: sanitizeFileName(file.name),
      file,
    })
    return NextResponse.json({ success: true, data: result }, { status: result.status === "COMPLETED" ? 200 : 202 })
  } catch (error) {
    if (error instanceof UploadLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.code === "CONFLICT" ? 409 : 400 })
    }
    return NextResponse.json({ success: false, error: "Upload failed" }, { status: 500 })
  }
}
