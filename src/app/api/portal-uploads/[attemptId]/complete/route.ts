import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePortalAuth, requirePortalPermission, PortalAuthError } from "@/lib/portal/auth"
import { UploadLifecycleError } from "@/lib/uploads/errors"
import { UploadRuntimeUnavailableError } from "@/lib/uploads/receipt"
import { completePortalUpload } from "@/lib/uploads/supporting-upload"

const OPAQUE_ATTEMPT_ID = /^c[a-z0-9]{20,31}$/

// Completion revalidates the live portal identity and canUploadDocuments
// permission before the promote/link transaction runs; the request row is
// re-read inside that transaction as the business source of truth.
export async function POST(_request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  let portalUserId: string
  try {
    const auth = await requirePortalAuth()
    portalUserId = auth.portalUserId
  } catch (error) {
    if (error instanceof PortalAuthError) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { attemptId } = await params
  if (!OPAQUE_ATTEMPT_ID.test(attemptId)) {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }
  const attempt = await prisma.uploadAttempt.findUnique({ where: { id: attemptId }, include: { supportingIntent: true } })
  if (
    !attempt ||
    attempt.actorType !== "PORTAL" ||
    attempt.portalUserId !== portalUserId ||
    attempt.uploadKind !== "PORTAL_REQUEST" ||
    !attempt.supportingIntent?.clientId
  ) {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }

  try {
    await requirePortalPermission(attempt.supportingIntent.clientId, "canUploadDocuments")
  } catch {
    return NextResponse.json({ success: false, error: "You do not have permission to upload for this request" }, { status: 403 })
  }

  try {
    const result = await completePortalUpload(attemptId, portalUserId)
    return NextResponse.json(
      { success: true, data: { ...result, ownerId: result.supportingDocumentId } },
      { status: result.status === "COMPLETED" ? 200 : 202 },
    )
  } catch (error) {
    if (error instanceof UploadRuntimeUnavailableError) {
      return NextResponse.json({ success: false, error: "Secure uploads are temporarily unavailable." }, { status: 503 })
    }
    if (error instanceof UploadLifecycleError) {
      const status = error.code === "SCAN_UNAVAILABLE" || error.code === "CONFLICT" ? 409 : 400
      return NextResponse.json({ success: false, error: error.message }, { status })
    }
    return NextResponse.json({ success: false, error: "Failed to complete upload" }, { status: 500 })
  }
}
