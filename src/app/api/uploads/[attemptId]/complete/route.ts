import { NextResponse } from "next/server"
import { UserRole } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getLiveStaffAuthorizationContext, requireOrganizationRole } from "@/lib/live-authorization"
import { completeTemplateUpload, TemplateUploadUnavailableError } from "@/lib/uploads/template-upload"
import { UploadLifecycleError } from "@/lib/uploads/errors"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
const OPAQUE_ATTEMPT_ID = /^c[a-z0-9]{20,31}$/

export async function POST(_request: Request, { params }: { params: Promise<{ attemptId: string }> }) {
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const { attemptId } = await params
  if (!OPAQUE_ATTEMPT_ID.test(attemptId)) return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  const attempt = await prisma.uploadAttempt.findUnique({ where: { id: attemptId } })
  if (!attempt || attempt.actorType !== "STAFF" || attempt.staffUserId !== identity.userId) {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }
  try {
    await requireOrganizationRole(attempt.organizationId, ADMIN_ROLES, "complete document template upload")
  } catch {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }
  try {
    const result = await completeTemplateUpload(attemptId, identity.userId)
    revalidatePath("/templates")
    return NextResponse.json({ success: true, data: result }, { status: result.status === "COMPLETED" ? 200 : 202 })
  } catch (error) {
    if (error instanceof TemplateUploadUnavailableError) {
      return NextResponse.json({ success: false, error: error.message }, { status: 503 })
    }
    if (error instanceof UploadLifecycleError) {
      const status = error.code === "SCAN_UNAVAILABLE" ? 409 : error.code === "CONFLICT" ? 409 : 400
      return NextResponse.json({ success: false, error: error.message }, { status })
    }
    return NextResponse.json({ success: false, error: "Failed to complete template upload" }, { status: 500 })
  }
}
