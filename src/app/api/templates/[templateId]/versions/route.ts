import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"
import { prisma } from "@/lib/db"
import { limiters } from "@/lib/rate-limit"
import { getLiveStaffAuthorizationContext, requireOrganizationRole } from "@/lib/live-authorization"
import {
  assertTemplateUploadRuntimeAvailable,
  initiateTemplateUpload,
  TemplateUploadUnavailableError,
} from "@/lib/uploads/template-upload"
import { UploadLifecycleError } from "@/lib/uploads/errors"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

export async function POST(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const rate = limiters.upload.check(identity.userId)
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many uploads. Try again in ${rate.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    )
  }
  const previous = await prisma.documentTemplate.findUnique({ where: { id: templateId } })
  if (!previous) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
  let authorization
  try {
    authorization = await requireOrganizationRole(previous.organizationId, ADMIN_ROLES, "upload document template version")
    assertTemplateUploadRuntimeAvailable()
  } catch (error) {
    if (error instanceof TemplateUploadUnavailableError || error instanceof Error && error.name.includes("Storage")) {
      return NextResponse.json({ success: false, error: "Secure template uploads are temporarily unavailable." }, { status: 503 })
    }
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }
  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  try {
    const result = await initiateTemplateUpload({
      organizationId: previous.organizationId,
      staffUserId: authorization.userId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      file,
      intent: {
        name: previous.name,
        description: previous.description ?? undefined,
        formType: previous.formType,
        program: previous.program ?? undefined,
        previousVersionId: previous.id,
      },
    })
    return NextResponse.json({ success: true, data: result }, { status: result.status === "COMPLETED" ? 200 : 202 })
  } catch (error) {
    if (error instanceof UploadLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.code === "CONFLICT" ? 409 : 400 })
    }
    return NextResponse.json({ success: false, error: "Failed to receive template version" }, { status: 500 })
  }
}
