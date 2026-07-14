import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { storeFile } from "@/lib/storage"
import { limiters } from "@/lib/rate-limit"
import { getLiveStaffAuthorizationContext, requireOrganizationRole } from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"
import { validate, createDocTemplateSchema } from "@/lib/validation"
import { validateTemplatePdfUpload, sanitizeTemplateFileName } from "@/lib/document-template-upload"
import { UserRole } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

// ── Staff: upload a brand-new DocumentTemplate — real PDF only, generated storage key ──
export async function POST(req: NextRequest) {
  let identity
  try {
    identity = await getLiveStaffAuthorizationContext()
  } catch {
    return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  }
  const orgId = identity.selectedOrganizationId
  if (!orgId) return NextResponse.json({ success: false, error: "No organization selected" }, { status: 400 })

  const rl = limiters.upload.check(identity.userId)
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many uploads. Try again in ${rl.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    )
  }

  let authorization
  try {
    authorization = await requireOrganizationRole(orgId, ADMIN_ROLES, "upload document template")
  } catch {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  const parsed = validate(createDocTemplateSchema, {
    name: formData.get("name"),
    description: formData.get("description") || undefined,
    formType: formData.get("formType") || undefined,
    program: formData.get("program") || undefined,
  })
  if (!parsed.success) return NextResponse.json({ success: false, error: parsed.error }, { status: 400 })
  const data = parsed.data

  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateTemplatePdfUpload({ fileName: file.name, declaredMimeType: file.type, buffer })
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }

  const originalFileName = sanitizeTemplateFileName(file.name)
  const storageKey = `templates/${orgId}/${crypto.randomUUID()}.pdf`

  let record
  try {
    record = await storeFile(storageKey, buffer, "application/pdf", originalFileName)
  } catch {
    return NextResponse.json({ success: false, error: "Failed to store file" }, { status: 400 })
  }

  let tpl
  try {
    tpl = await prisma.documentTemplate.create({
      data: {
        organizationId: orgId,
        name: data.name,
        description: data.description,
        formType: data.formType,
        program: data.program,
        fileUrl: record.url,
        fileKey: record.key,
        fileSize: record.size,
        mimeType: "application/pdf",
        uploadedById: authorization.userId,
        status: "draft",
      },
    })
  } catch {
    // The stored file is orphaned (unreferenced) rather than left pointing
    // at a broken row — no DocumentTemplate row is created on failure.
    return NextResponse.json({ success: false, error: "Failed to save template" }, { status: 500 })
  }

  await createAuditEvent({
    organizationId: orgId,
    actorId: authorization.userId,
    action: "TEMPLATE_UPLOADED",
    targetType: "document_template",
    targetId: tpl.id,
    metadata: { name: tpl.name, originalFileName },
  })
  revalidatePath("/templates")

  return NextResponse.json({ success: true, data: { id: tpl.id } })
}
