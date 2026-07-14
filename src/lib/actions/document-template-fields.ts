"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireActiveOrganizationMembership, requireOrganizationRole } from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"
import { validate, createTemplateFieldSchema, updateTemplateFieldSchema } from "@/lib/validation"
import { getFieldConditionDependencySummary } from "@/lib/actions/template-conditions"
import { UserRole } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

type ActionResult<T = Record<string, unknown>> = { success: true; data: T } | { success: false; error: string }

// ── Read: available to any authorized org member, including for retired (read-only) templates ──
export async function getDocumentTemplateFields(documentTemplateId: string) {
  const template = await prisma.documentTemplate.findUnique({ where: { id: documentTemplateId } })
  if (!template) throw new Error("Template not found")
  await requireActiveOrganizationMembership(template.organizationId, "view document template fields")

  return prisma.documentTemplateField.findMany({
    where: { documentTemplateId },
    orderBy: { sortOrder: "asc" },
  })
}

export async function createDocumentTemplateField(documentTemplateId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createTemplateFieldSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const template = await prisma.documentTemplate.findUnique({ where: { id: documentTemplateId } })
  if (!template) return { success: false, error: "Template not found" }
  const authorization = await requireOrganizationRole(template.organizationId, ADMIN_ROLES, "create document template field")
  if (template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  const existing = await prisma.documentTemplateField.findUnique({
    where: { documentTemplateId_fieldKey: { documentTemplateId, fieldKey: data.fieldKey } },
  })
  if (existing) return { success: false, error: "A field with this key already exists on this template" }

  const field = await prisma.documentTemplateField.create({
    data: {
      organizationId: template.organizationId,
      documentTemplateId,
      fieldKey: data.fieldKey,
      name: data.name,
      fieldType: data.fieldType,
      pageNumber: data.pageNumber,
      posX: data.posX ?? null,
      posY: data.posY ?? null,
      width: data.width ?? null,
      height: data.height ?? null,
      isRequired: data.isRequired,
      sortOrder: data.sortOrder,
    },
  })

  await createAuditEvent({
    organizationId: template.organizationId,
    actorId: authorization.userId,
    action: "TEMPLATE_FIELD_CREATED",
    targetType: "document_template_field",
    targetId: field.id,
    metadata: { documentTemplateId, templateFieldId: field.id, fieldKey: field.fieldKey, action: "created" },
  })
  revalidatePath(`/templates/${documentTemplateId}/fields`)
  revalidatePath("/templates")
  return { success: true, data: { id: field.id } }
}

export async function updateDocumentTemplateField(fieldId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(updateTemplateFieldSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const field = await prisma.documentTemplateField.findUnique({
    where: { id: fieldId },
    include: { documentTemplate: { select: { id: true, organizationId: true, status: true } } },
  })
  if (!field) return { success: false, error: "Field not found" }
  const authorization = await requireOrganizationRole(field.documentTemplate.organizationId, ADMIN_ROLES, "update document template field")
  if (field.documentTemplate.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  if (data.fieldKey && data.fieldKey !== field.fieldKey) {
    const existing = await prisma.documentTemplateField.findUnique({
      where: { documentTemplateId_fieldKey: { documentTemplateId: field.documentTemplateId, fieldKey: data.fieldKey } },
    })
    if (existing) return { success: false, error: "A field with this key already exists on this template" }

    // Renaming a fieldKey that conditions depend on would silently break
    // those conditions' stable references — block it rather than rewrite
    // condition rows implicitly.
    const dependencies = await getFieldConditionDependencySummary(field.documentTemplateId, field.fieldKey)
    if (dependencies.count > 0) {
      return { success: false, error: `Cannot rename: ${dependencies.count} condition(s) depend on this field key (${dependencies.purposes.join(", ")})` }
    }
  }

  const updated = await prisma.documentTemplateField.update({
    where: { id: fieldId },
    data: {
      ...(data.fieldKey !== undefined && { fieldKey: data.fieldKey }),
      ...(data.name !== undefined && { name: data.name }),
      ...(data.fieldType !== undefined && { fieldType: data.fieldType }),
      ...(data.pageNumber !== undefined && { pageNumber: data.pageNumber }),
      ...(data.posX !== undefined && { posX: data.posX }),
      ...(data.posY !== undefined && { posY: data.posY }),
      ...(data.width !== undefined && { width: data.width }),
      ...(data.height !== undefined && { height: data.height }),
      ...(data.isRequired !== undefined && { isRequired: data.isRequired }),
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    },
  })

  await createAuditEvent({
    organizationId: field.documentTemplate.organizationId,
    actorId: authorization.userId,
    action: "TEMPLATE_FIELD_UPDATED",
    targetType: "document_template_field",
    targetId: fieldId,
    metadata: { documentTemplateId: field.documentTemplateId, templateFieldId: fieldId, fieldKey: updated.fieldKey, action: "updated" },
  })
  revalidatePath(`/templates/${field.documentTemplateId}/fields`)
  return { success: true, data: { id: fieldId } }
}

export async function deleteDocumentTemplateField(fieldId: string): Promise<ActionResult<{ id: string }>> {
  const field = await prisma.documentTemplateField.findUnique({
    where: { id: fieldId },
    include: { documentTemplate: { select: { id: true, organizationId: true, status: true } } },
  })
  if (!field) return { success: false, error: "Field not found" }
  const authorization = await requireOrganizationRole(field.documentTemplate.organizationId, ADMIN_ROLES, "delete document template field")
  if (field.documentTemplate.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  const dependencies = await getFieldConditionDependencySummary(field.documentTemplateId, field.fieldKey)
  if (dependencies.count > 0) {
    return { success: false, error: `Cannot delete: ${dependencies.count} condition(s) depend on this field key (${dependencies.purposes.join(", ")})` }
  }

  await prisma.documentTemplateField.delete({ where: { id: fieldId } })

  await createAuditEvent({
    organizationId: field.documentTemplate.organizationId,
    actorId: authorization.userId,
    action: "TEMPLATE_FIELD_DELETED",
    targetType: "document_template_field",
    targetId: fieldId,
    metadata: { documentTemplateId: field.documentTemplateId, templateFieldId: fieldId, fieldKey: field.fieldKey, action: "deleted" },
  })
  revalidatePath(`/templates/${field.documentTemplateId}/fields`)
  return { success: true, data: { id: fieldId } }
}
