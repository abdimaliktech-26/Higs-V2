import { NextResponse } from "next/server"
import { prisma } from "@/lib/db"
import { getLiveStaffAuthorizationContext, requireActiveOrganizationMembership } from "@/lib/live-authorization"
import { toStaffUploadStatusResponse } from "@/lib/uploads/status"

const OPAQUE_ATTEMPT_ID = /^c[a-z0-9]{20,31}$/

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ attemptId: string }> },
) {
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }

  const { attemptId } = await params
  if (!OPAQUE_ATTEMPT_ID.test(attemptId)) {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }
  const attempt = await prisma.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.actorType !== "STAFF" || attempt.staffUserId !== identity.userId) {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }

  try {
    await requireActiveOrganizationMembership(attempt.organizationId, "view own upload status")
  } catch {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }

  return NextResponse.json(
    { success: true, data: toStaffUploadStatusResponse(attempt) },
    { headers: { "Cache-Control": "private, no-store" } },
  )
}
