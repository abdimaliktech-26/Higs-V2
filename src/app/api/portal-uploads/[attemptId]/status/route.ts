import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { requirePortalAuth, requirePortalPermission, PortalAuthError } from "@/lib/portal/auth"
import { toStaffUploadStatusResponse } from "@/lib/uploads/status"

const OPAQUE_ATTEMPT_ID = /^c[a-z0-9]{20,31}$/

// Original-uploader-only bounded lifecycle state; exposes no storage
// location, filename, scanner reference, or provider detail.
export async function GET(_request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
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
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }

  return NextResponse.json(
    { success: true, data: toStaffUploadStatusResponse(attempt) },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
