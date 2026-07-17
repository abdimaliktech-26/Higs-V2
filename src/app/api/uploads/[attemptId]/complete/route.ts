import { NextResponse } from "next/server"
import { UserRole } from "@prisma/client"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { getLiveStaffAuthorizationContext, requireOrganizationRole } from "@/lib/live-authorization"
import { completeTemplateUpload, TemplateUploadUnavailableError } from "@/lib/uploads/template-upload"
import { completeStaffSupportingUpload } from "@/lib/uploads/supporting-upload"
import { UploadRuntimeUnavailableError } from "@/lib/uploads/receipt"
import {
  authorizeStaffSupportingUpload,
  SupportingUploadAuthorizationError,
} from "@/lib/uploads/staff-supporting-authorization"
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
  const attempt = await prisma.uploadAttempt.findUnique({ where: { id: attemptId }, include: { supportingIntent: true } })
  if (!attempt || attempt.actorType !== "STAFF" || attempt.staffUserId !== identity.userId) {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }

  // Completion reauthorizes against live database state using the same
  // authorization contract as the matching initiation route.
  if (attempt.uploadKind === "STAFF_SUPPORTING") {
    const intent = attempt.supportingIntent
    if (!intent) return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
    let authorization
    try {
      authorization = await authorizeStaffSupportingUpload({ clientId: intent.clientId, packetId: intent.packetId })
    } catch (error) {
      const message = error instanceof SupportingUploadAuthorizationError ? error.message : "Access denied"
      return NextResponse.json({ success: false, error: message }, { status: 403 })
    }
    if (authorization.organizationId !== attempt.organizationId) {
      return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
    }
    return runCompletion(async () => {
      const result = await completeStaffSupportingUpload(attemptId, identity.userId)
      return { ...result, ownerId: result.supportingDocumentId }
    }, "/library")
  }

  if (attempt.uploadKind !== "TEMPLATE" && attempt.uploadKind !== "TEMPLATE_VERSION") {
    return NextResponse.json({ success: false, error: "Upload not found" }, { status: 404 })
  }
  try {
    await requireOrganizationRole(attempt.organizationId, ADMIN_ROLES, "complete document template upload")
  } catch {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }
  return runCompletion(async () => {
    const result = await completeTemplateUpload(attemptId, identity.userId)
    return { ...result, ownerId: result.templateId }
  }, "/templates")
}

async function runCompletion(
  complete: () => Promise<{ attemptId: string; status: string } & Record<string, unknown>>,
  revalidate: string,
): Promise<NextResponse> {
  try {
    const result = await complete()
    revalidatePath(revalidate)
    return NextResponse.json({ success: true, data: result }, { status: result.status === "COMPLETED" ? 200 : 202 })
  } catch (error) {
    if (error instanceof TemplateUploadUnavailableError || error instanceof UploadRuntimeUnavailableError) {
      return NextResponse.json({ success: false, error: "Secure uploads are temporarily unavailable." }, { status: 503 })
    }
    if (error instanceof UploadLifecycleError) {
      const status = error.code === "SCAN_UNAVAILABLE" || error.code === "CONFLICT" ? 409 : 400
      return NextResponse.json({ success: false, error: error.message }, { status })
    }
    return NextResponse.json({ success: false, error: "Failed to complete upload" }, { status: 500 })
  }
}
