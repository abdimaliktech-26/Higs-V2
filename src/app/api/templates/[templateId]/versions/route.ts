import crypto from "crypto"
import { NextRequest, NextResponse } from "next/server"
import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { storeFile } from "@/lib/storage"
import { limiters } from "@/lib/rate-limit"
import { auth } from "@/lib/auth"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { validateTemplatePdfUpload, sanitizeTemplateFileName } from "@/lib/document-template-upload"
import { UserRole, Prisma } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

function canManage(user: Record<string, unknown>) {
  const role = getActiveRole(user as any)
  return (user.isSuperAdmin as boolean) || ADMIN_ROLES.includes(role)
}

// ── Staff: upload a new version of an existing DocumentTemplate — real PDF only ──
// Creates a new row (version = previous + 1) rather than mutating the
// existing one, so the prior version and its stored file stay untouched and
// downloadable. packetTypes is deliberately never copied — that field is
// deprecated and derived-usage-only now (see docs/UI_CORRECTION_STATUS.md).
export async function POST(req: NextRequest, { params }: { params: Promise<{ templateId: string }> }) {
  const { templateId } = await params

  const session = await auth()
  if (!session?.user) return NextResponse.json({ success: false, error: "Unauthorized" }, { status: 401 })
  const user = session.user as Record<string, unknown>

  const rl = limiters.upload.check(user.id as string)
  if (!rl.allowed) {
    return NextResponse.json(
      { success: false, error: `Too many uploads. Try again in ${rl.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    )
  }

  if (!canManage(user)) {
    return NextResponse.json({ success: false, error: "Insufficient permissions" }, { status: 403 })
  }

  const previous = await prisma.documentTemplate.findUnique({ where: { id: templateId } })
  if (!previous) return NextResponse.json({ success: false, error: "Not found" }, { status: 404 })
  try {
    await requireOrgAccess(previous.organizationId)
  } catch {
    return NextResponse.json({ success: false, error: "Access denied" }, { status: 403 })
  }

  const formData = await req.formData()
  const file = formData.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 })
  }

  const buffer = Buffer.from(await file.arrayBuffer())
  const validation = validateTemplatePdfUpload({ fileName: file.name, declaredMimeType: file.type, buffer })
  if (!validation.valid) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 })
  }

  const originalFileName = sanitizeTemplateFileName(file.name)
  const storageKey = `templates/${previous.organizationId}/${crypto.randomUUID()}.pdf`

  let record
  try {
    record = await storeFile(storageKey, buffer, "application/pdf", originalFileName)
  } catch {
    return NextResponse.json({ success: false, error: "Failed to store file" }, { status: 400 })
  }

  let tpl
  try {
    tpl = await prisma.$transaction(async (tx) => {
      const created = await tx.documentTemplate.create({
        data: {
          organizationId: previous.organizationId,
          name: previous.name,
          description: previous.description,
          formType: previous.formType,
          program: previous.program,
          version: previous.version + 1,
          previousVersionId: previous.id,
          fileUrl: record.url,
          fileKey: record.key,
          fileSize: record.size,
          mimeType: "application/pdf",
          uploadedById: user.id as string,
          status: "draft",
        },
      })

      // Carry the prior version's field layout forward as a starting point —
      // fresh rows/ids, fieldKey and geometry preserved, old version's own
      // field rows are never touched.
      const priorFields = await tx.documentTemplateField.findMany({ where: { documentTemplateId: previous.id } })
      if (priorFields.length > 0) {
        await tx.documentTemplateField.createMany({
          data: priorFields.map((f) => ({
            organizationId: f.organizationId,
            documentTemplateId: created.id,
            fieldKey: f.fieldKey,
            name: f.name,
            fieldType: f.fieldType,
            pageNumber: f.pageNumber,
            posX: f.posX,
            posY: f.posY,
            width: f.width,
            height: f.height,
            isRequired: f.isRequired,
            sortOrder: f.sortOrder,
          })),
        })

        // Carry field-owned conditional logic forward too — fresh ids, owner
        // remapped by fieldKey match onto the new version's fields, nested
        // groups reattached under the newly created root's id. Old version's
        // own groups/conditions are never touched. Packet-document-owned
        // conditions are out of scope until cross-document conditions land.
        const newFields = await tx.documentTemplateField.findMany({ where: { documentTemplateId: created.id } })
        const newFieldIdByKey = new Map(newFields.map((f) => [f.fieldKey, f.id]))
        const oldFieldKeyById = new Map(priorFields.map((f) => [f.id, f.fieldKey]))

        const priorRootGroups = await tx.templateConditionGroup.findMany({
          where: { documentTemplateFieldId: { in: priorFields.map((f) => f.id) }, parentGroupId: null },
          include: { conditions: true, childGroups: { include: { conditions: true } } },
        })

        for (const rootGroup of priorRootGroups) {
          const fieldKey = oldFieldKeyById.get(rootGroup.documentTemplateFieldId as string)
          const newFieldId = fieldKey ? newFieldIdByKey.get(fieldKey) : undefined
          if (!newFieldId) {
            throw new Error(`Cannot carry forward conditions: no field with key "${fieldKey}" on the new version`)
          }

          const newRootGroup = await tx.templateConditionGroup.create({
            data: {
              organizationId: previous.organizationId,
              purpose: rootGroup.purpose,
              logicOperator: rootGroup.logicOperator,
              documentTemplateFieldId: newFieldId,
            },
          })

          if (rootGroup.conditions.length > 0) {
            await tx.templateCondition.createMany({
              data: rootGroup.conditions.map((c) => ({
                groupId: newRootGroup.id,
                sourceType: c.sourceType,
                sourceFieldKey: c.sourceFieldKey,
                operator: c.operator,
                comparisonValue: (c.comparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                sortOrder: c.sortOrder,
              })),
            })
          }

          for (const childGroup of rootGroup.childGroups) {
            const newChildGroup = await tx.templateConditionGroup.create({
              data: {
                organizationId: previous.organizationId,
                purpose: childGroup.purpose,
                logicOperator: childGroup.logicOperator,
                parentGroupId: newRootGroup.id,
              },
            })

            if (childGroup.conditions.length > 0) {
              await tx.templateCondition.createMany({
                data: childGroup.conditions.map((c) => ({
                  groupId: newChildGroup.id,
                  sourceType: c.sourceType,
                  sourceFieldKey: c.sourceFieldKey,
                  operator: c.operator,
                  comparisonValue: (c.comparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
                  sortOrder: c.sortOrder,
                })),
              })
            }
          }
        }
      }

      return created
    })
  } catch {
    // No new row exists if this fails — the prior version remains the only,
    // fully intact record; the freshly stored file is simply unreferenced.
    return NextResponse.json({ success: false, error: "Failed to save new version" }, { status: 500 })
  }

  await createAuditEvent({
    organizationId: previous.organizationId,
    actorId: user.id as string,
    action: "DOCUMENT_TEMPLATE_VERSION_CREATED",
    targetType: "document_template",
    targetId: tpl.id,
    metadata: { name: tpl.name, version: tpl.version, previousVersionId: previous.id, originalFileName },
  })
  revalidatePath("/templates")

  return NextResponse.json({ success: true, data: { id: tpl.id, version: tpl.version } })
}
