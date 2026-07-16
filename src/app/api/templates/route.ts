import { NextRequest, NextResponse } from "next/server"
import { UserRole } from "@prisma/client"
import { limiters } from "@/lib/rate-limit"
import { getLiveStaffAuthorizationContext, requireOrganizationRole } from "@/lib/live-authorization"
import { validate, createDocTemplateSchema } from "@/lib/validation"
import {
  assertTemplateUploadRuntimeAvailable,
  initiateTemplateUpload,
  TemplateUploadUnavailableError,
} from "@/lib/uploads/template-upload"
import { UploadLifecycleError } from "@/lib/uploads/errors"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

// PR-5B.2B: receipt ends at SCANNING. GuardDuty is asynchronous, so the
// DocumentTemplate owner is created only by the authenticated completion
// endpoint after a version-bound CLEAN result has been recorded.
export async function POST(req: NextRequest) {
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const organizationId = identity.selectedOrganizationId
  if (!organizationId) return NextResponse.json({ success: false, error: "No organization selected" }, { status: 400 })

  const rate = limiters.upload.check(identity.userId)
  if (!rate.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many uploads. Try again in ${rate.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rate.retryAfter) } },
    )
  }
  let authorization
  try {
    authorization = await requireOrganizationRole(organizationId, ADMIN_ROLES, "upload document template")
    // Fail before multipart parsing/byte acceptance when the operating gate is closed.
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
  const parsed = validate(createDocTemplateSchema, {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    formType: formData.get("formType") || undefined,
    program: formData.get("program") || undefined,
  })
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })

  try {
    const result = await initiateTemplateUpload({
      organizationId,
      staffUserId: authorization.userId,
      idempotencyKey: req.headers.get("idempotency-key") ?? "",
      file,
      intent: parsed.data,
    })
    return NextResponse.json({ success: true, data: result }, { status: result.status === "COMPLETED" ? 200 : 202 })
  } catch (error) {
    if (error instanceof UploadLifecycleError) {
      return NextResponse.json({ success: false, error: error.message }, { status: error.code === "CONFLICT" ? 409 : 400 })
    }
    return NextResponse.json({ success: false, error: "Failed to receive template upload" }, { status: 500 })
  }
}
