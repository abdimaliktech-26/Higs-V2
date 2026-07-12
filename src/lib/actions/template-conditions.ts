"use server"

import { revalidatePath } from "next/cache"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import {
  validate,
  createRootConditionGroupSchema,
  createNestedConditionGroupSchema,
  updateConditionGroupSchema,
  createConditionSchema,
  updateConditionSchema,
} from "@/lib/validation"
import { resolveCompatibilityKind, isOperatorCompatible, validateComparisonValueShape } from "@/lib/conditions/operator-compatibility"
import type { ConditionOperator, ConditionSourceType } from "@/lib/conditions/types"
import { UserRole, Prisma } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

function canManage(user: Record<string, unknown>) {
  const role = getActiveRole(user as any)
  return (user.isSuperAdmin as boolean) || ADMIN_ROLES.includes(role)
}

type ActionResult<T = Record<string, unknown>> = { success: true; data: T } | { success: false; error: string }

async function requireStaffManager(): Promise<{ success: false; error: string } | { success: true; user: Record<string, unknown> }> {
  const session = await auth()
  if (!session?.user) return { success: false, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  if (!canManage(user)) return { success: false, error: "Insufficient permissions" }
  return { success: true, user }
}

// ── Owner resolution — Step 4a only ever creates field-owned (documentTemplateFieldId) groups ──
async function getFieldOwnerContext(documentTemplateFieldId: string) {
  const field = await prisma.documentTemplateField.findUnique({
    where: { id: documentTemplateFieldId },
    include: { documentTemplate: { select: { id: true, organizationId: true, status: true } } },
  })
  if (!field) return null
  return { field, template: field.documentTemplate }
}

/** Walks parentGroupId up to the root — at most one hop given the depth-2 cap, but loops defensively. */
async function resolveRootGroup(groupId: string) {
  const first = await prisma.templateConditionGroup.findUnique({ where: { id: groupId } })
  if (!first) return null

  let current = first
  const visited = new Set<string>([current.id])
  while (current.parentGroupId) {
    if (visited.has(current.parentGroupId)) return null // circular guard — should never happen given creation-time checks
    const next = await prisma.templateConditionGroup.findUnique({ where: { id: current.parentGroupId } })
    if (!next) return null
    visited.add(next.id)
    current = next
  }
  return current
}

async function getGroupOwnerContext(groupId: string) {
  const root = await resolveRootGroup(groupId)
  if (!root || !root.documentTemplateFieldId) return null
  return getFieldOwnerContext(root.documentTemplateFieldId)
}

// ── Root group: create ──
export async function createRootConditionGroup(documentTemplateFieldId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createRootConditionGroupSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const owner = await getFieldOwnerContext(documentTemplateFieldId)
  if (!owner) return { success: false, error: "Field not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  const group = await prisma.templateConditionGroup.create({
    data: {
      organizationId: owner.template.organizationId,
      purpose: data.purpose,
      logicOperator: data.logicOperator,
      documentTemplateFieldId,
    },
  })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_CREATED",
    targetType: "template_condition_group",
    targetId: group.id,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: group.id, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "group_created" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: group.id } }
}

// ── Nested group: create (max depth 2 — parent must itself be a root group) ──
export async function createNestedConditionGroup(parentGroupId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createNestedConditionGroupSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const parent = await prisma.templateConditionGroup.findUnique({ where: { id: parentGroupId } })
  if (!parent) return { success: false, error: "Parent group not found" }
  if (parent.parentGroupId) return { success: false, error: "Maximum nesting depth (2) exceeded" }
  if (!parent.documentTemplateFieldId) return { success: false, error: "Only field-owned condition groups are supported in this step" }

  const owner = await getFieldOwnerContext(parent.documentTemplateFieldId)
  if (!owner) return { success: false, error: "Field not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  const group = await prisma.templateConditionGroup.create({
    data: {
      organizationId: owner.template.organizationId,
      purpose: parent.purpose,
      logicOperator: data.logicOperator,
      parentGroupId,
      // Nested groups never carry their own owner — they belong to the root's owner.
    },
  })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_CREATED",
    targetType: "template_condition_group",
    targetId: group.id,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: group.id, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "nested_group_created" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: group.id } }
}

// ── Group: update logic operator ──
export async function updateConditionGroupLogicOperator(groupId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(updateConditionGroupSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const group = await prisma.templateConditionGroup.findUnique({ where: { id: groupId } })
  if (!group) return { success: false, error: "Group not found" }
  const owner = await getGroupOwnerContext(groupId)
  if (!owner) return { success: false, error: "Group not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  await prisma.templateConditionGroup.update({ where: { id: groupId }, data: { logicOperator: data.logicOperator } })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_UPDATED",
    targetType: "template_condition_group",
    targetId: groupId,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: groupId, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "group_logic_operator_updated" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: groupId } }
}

// ── Group: delete (cascades to its conditions and any nested child group) ──
export async function deleteConditionGroup(groupId: string): Promise<ActionResult<{ id: string }>> {
  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const group = await prisma.templateConditionGroup.findUnique({ where: { id: groupId } })
  if (!group) return { success: false, error: "Group not found" }
  const owner = await getGroupOwnerContext(groupId)
  if (!owner) return { success: false, error: "Group not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  await prisma.templateConditionGroup.delete({ where: { id: groupId } })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_DELETED",
    targetType: "template_condition_group",
    targetId: groupId,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: groupId, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "group_deleted" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: groupId } }
}

async function resolveConditionSourceKind(
  organizationId: string,
  documentTemplateId: string,
  sourceType: ConditionSourceType,
  sourceFieldKey: string | undefined
): Promise<{ ok: true; resolvedFieldKey: string | null } | { ok: false; error: string }> {
  if (sourceType === "TEMPLATE_FIELD") {
    if (!sourceFieldKey) return { ok: false, error: "sourceFieldKey is required for TEMPLATE_FIELD conditions" }
    const field = await prisma.documentTemplateField.findUnique({
      where: { documentTemplateId_fieldKey: { documentTemplateId, fieldKey: sourceFieldKey } },
    })
    if (!field) {
      // Distinguish "doesn't exist at all" from "exists on a different template" for a clearer error.
      const elsewhere = await prisma.documentTemplateField.findFirst({ where: { organizationId, fieldKey: sourceFieldKey, documentTemplateId: { not: documentTemplateId } } })
      return { ok: false, error: elsewhere ? "Field belongs to a different template" : "Field not found on this template" }
    }
    return { ok: true, resolvedFieldKey: sourceFieldKey }
  }
  // Pseudo-fields never carry a sourceFieldKey.
  if (sourceFieldKey) return { ok: false, error: `${sourceType} must not include a sourceFieldKey` }
  return { ok: true, resolvedFieldKey: null }
}

async function validateOperatorAndValue(
  organizationId: string,
  documentTemplateId: string,
  sourceType: ConditionSourceType,
  sourceFieldKey: string | undefined,
  operator: ConditionOperator,
  comparisonValue: unknown
): Promise<{ ok: true; resolvedFieldKey: string | null } | { ok: false; error: string }> {
  const sourceResult = await resolveConditionSourceKind(organizationId, documentTemplateId, sourceType, sourceFieldKey)
  if (!sourceResult.ok) return sourceResult

  let fieldType: string | undefined
  if (sourceType === "TEMPLATE_FIELD") {
    const field = await prisma.documentTemplateField.findUnique({ where: { documentTemplateId_fieldKey: { documentTemplateId, fieldKey: sourceResult.resolvedFieldKey! } } })
    fieldType = field?.fieldType
  }

  const kind = resolveCompatibilityKind(sourceType, fieldType)
  if (!kind || !isOperatorCompatible(operator, kind)) {
    return { ok: false, error: `Operator ${operator} is not valid for this field type` }
  }

  const shapeCheck = validateComparisonValueShape(operator, comparisonValue)
  if (!shapeCheck.valid) return { ok: false, error: shapeCheck.error }

  return { ok: true, resolvedFieldKey: sourceResult.resolvedFieldKey }
}

// ── Condition: create ──
export async function createCondition(groupId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createConditionSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const group = await prisma.templateConditionGroup.findUnique({ where: { id: groupId } })
  if (!group) return { success: false, error: "Group not found" }
  const owner = await getGroupOwnerContext(groupId)
  if (!owner) return { success: false, error: "Group not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  const check = await validateOperatorAndValue(owner.template.organizationId, owner.template.id, data.sourceType, data.sourceFieldKey, data.operator, data.comparisonValue)
  if (!check.ok) return { success: false, error: check.error }

  const condition = await prisma.templateCondition.create({
    data: {
      groupId,
      sourceType: data.sourceType,
      sourceFieldKey: check.resolvedFieldKey,
      operator: data.operator,
      comparisonValue: (data.comparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      sortOrder: data.sortOrder,
    },
  })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_CREATED",
    targetType: "template_condition",
    targetId: condition.id,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: groupId, conditionId: condition.id, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "condition_created" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: condition.id } }
}

// ── Condition: update ──
export async function updateCondition(conditionId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(updateConditionSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const existing = await prisma.templateCondition.findUnique({ where: { id: conditionId } })
  if (!existing) return { success: false, error: "Condition not found" }
  const group = await prisma.templateConditionGroup.findUnique({ where: { id: existing.groupId } })
  if (!group) return { success: false, error: "Condition not found" }
  const owner = await getGroupOwnerContext(existing.groupId)
  if (!owner) return { success: false, error: "Condition not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  const mergedSourceType = data.sourceType ?? (existing.sourceType as ConditionSourceType)
  const mergedSourceFieldKey = data.sourceFieldKey !== undefined ? data.sourceFieldKey : existing.sourceFieldKey ?? undefined
  const mergedOperator = data.operator ?? (existing.operator as ConditionOperator)
  const mergedComparisonValue = data.comparisonValue !== undefined ? data.comparisonValue : existing.comparisonValue

  const check = await validateOperatorAndValue(owner.template.organizationId, owner.template.id, mergedSourceType, mergedSourceFieldKey, mergedOperator, mergedComparisonValue)
  if (!check.ok) return { success: false, error: check.error }

  await prisma.templateCondition.update({
    where: { id: conditionId },
    data: {
      sourceType: mergedSourceType,
      sourceFieldKey: check.resolvedFieldKey,
      operator: mergedOperator,
      comparisonValue: (mergedComparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    },
  })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_UPDATED",
    targetType: "template_condition",
    targetId: conditionId,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: existing.groupId, conditionId, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "condition_updated" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: conditionId } }
}

// ── Condition: delete ──
export async function deleteCondition(conditionId: string): Promise<ActionResult<{ id: string }>> {
  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const existing = await prisma.templateCondition.findUnique({ where: { id: conditionId } })
  if (!existing) return { success: false, error: "Condition not found" }
  const group = await prisma.templateConditionGroup.findUnique({ where: { id: existing.groupId } })
  if (!group) return { success: false, error: "Condition not found" }
  const owner = await getGroupOwnerContext(existing.groupId)
  if (!owner) return { success: false, error: "Condition not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }

  await prisma.templateCondition.delete({ where: { id: conditionId } })

  await createAuditEvent({
    organizationId: owner.template.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_DELETED",
    targetType: "template_condition",
    targetId: conditionId,
    metadata: { documentTemplateId: owner.template.id, conditionGroupId: existing.groupId, conditionId, purpose: group.purpose, ownerFieldKey: owner.field.fieldKey, action: "condition_deleted" },
  })
  revalidatePath(`/templates/${owner.template.id}/fields`)
  return { success: true, data: { id: conditionId } }
}

// ── Read: full condition tree for a template's field-owned groups — reads allowed even on retired templates ──
export async function getConditionsForTemplate(documentTemplateId: string) {
  const template = await prisma.documentTemplate.findUnique({ where: { id: documentTemplateId } })
  if (!template) throw new Error("Template not found")
  await requireOrgAccess(template.organizationId)

  const fieldIds = (await prisma.documentTemplateField.findMany({ where: { documentTemplateId }, select: { id: true } })).map((f) => f.id)
  if (fieldIds.length === 0) return []

  return prisma.templateConditionGroup.findMany({
    where: { documentTemplateFieldId: { in: fieldIds } },
    include: {
      conditions: { orderBy: { sortOrder: "asc" } },
      childGroups: { include: { conditions: { orderBy: { sortOrder: "asc" } } } },
    },
  })
}

export interface FieldConditionDependencySummary {
  count: number
  purposes: string[]
}

// ── Dependency lookup — reused by document-template-fields.ts to block delete/rename ──
export async function getFieldConditionDependencySummary(documentTemplateId: string, fieldKey: string): Promise<FieldConditionDependencySummary> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: documentTemplateId } })
  if (!template) throw new Error("Template not found")
  await requireOrgAccess(template.organizationId)

  const fieldIds = (await prisma.documentTemplateField.findMany({ where: { documentTemplateId }, select: { id: true } })).map((f) => f.id)
  if (fieldIds.length === 0) return { count: 0, purposes: [] }

  const conditions = await prisma.templateCondition.findMany({
    where: {
      sourceType: "TEMPLATE_FIELD",
      sourceFieldKey: fieldKey,
      group: {
        OR: [
          { documentTemplateFieldId: { in: fieldIds } },
          { parentGroup: { documentTemplateFieldId: { in: fieldIds } } },
        ],
      },
    },
    include: { group: { select: { purpose: true } } },
  })

  return {
    count: conditions.length,
    purposes: Array.from(new Set(conditions.map((c) => c.group.purpose))),
  }
}

export interface TemplateConditionValidationError {
  type:
    | "nonexistent_field_key"
    | "cross_template_reference"
    | "invalid_operator_for_type"
    | "malformed_comparison_value"
    | "excessive_nesting"
    | "circular_group"
    | "owner_mismatch"
    | "empty_group"
    | "ownerless_root_group"
    | "multiple_owners"
  groupId?: string
  conditionId?: string
  message: string
}

// ── Full consistency check for a template's field-owned conditions ──
// Most of these classes are already prevented at write time by the CRUD
// actions above — this is a defense-in-depth re-verification of current
// state, and the gate `updateTemplateStatus` calls before allowing a
// template to become "active".
export async function validateTemplateConditions(documentTemplateId: string): Promise<{ valid: boolean; errors: TemplateConditionValidationError[] }> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: documentTemplateId } })
  if (!template) throw new Error("Template not found")
  await requireOrgAccess(template.organizationId)

  const templateFields = await prisma.documentTemplateField.findMany({ where: { documentTemplateId }, select: { id: true, fieldKey: true, fieldType: true } })
  const fieldIds = templateFields.map((f) => f.id)
  const fieldKeyToType = new Map(templateFields.map((f) => [f.fieldKey, f.fieldType]))

  const errors: TemplateConditionValidationError[] = []
  if (fieldIds.length === 0) return { valid: true, errors }

  const rootGroups = await prisma.templateConditionGroup.findMany({
    where: { documentTemplateFieldId: { in: fieldIds } },
    include: {
      conditions: true,
      childGroups: { include: { conditions: true, childGroups: true } },
    },
  })

  async function checkCondition(condition: { id: string; sourceType: string; sourceFieldKey: string | null; operator: string; comparisonValue: unknown }, groupId: string) {
    if (condition.sourceType === "TEMPLATE_FIELD") {
      if (!condition.sourceFieldKey || !fieldKeyToType.has(condition.sourceFieldKey)) {
        const elsewhere = condition.sourceFieldKey
          ? await prisma.documentTemplateField.findFirst({ where: { organizationId: template!.organizationId, fieldKey: condition.sourceFieldKey, documentTemplateId: { not: documentTemplateId } } })
          : null
        errors.push({
          type: elsewhere ? "cross_template_reference" : "nonexistent_field_key",
          groupId, conditionId: condition.id,
          message: elsewhere ? `References field "${condition.sourceFieldKey}" from a different template` : `References unknown field key "${condition.sourceFieldKey}"`,
        })
        return
      }
    }
    const fieldType = condition.sourceType === "TEMPLATE_FIELD" ? fieldKeyToType.get(condition.sourceFieldKey!) : undefined
    const kind = resolveCompatibilityKind(condition.sourceType as ConditionSourceType, fieldType)
    if (!kind || !isOperatorCompatible(condition.operator as ConditionOperator, kind)) {
      errors.push({ type: "invalid_operator_for_type", groupId, conditionId: condition.id, message: `Operator ${condition.operator} is not valid for this field type` })
    }
    const shapeCheck = validateComparisonValueShape(condition.operator as ConditionOperator, condition.comparisonValue)
    if (!shapeCheck.valid) {
      errors.push({ type: "malformed_comparison_value", groupId, conditionId: condition.id, message: shapeCheck.error })
    }
  }

  for (const root of rootGroups) {
    if (root.parentGroupId === root.id) errors.push({ type: "circular_group", groupId: root.id, message: "Group references itself as its own parent" })

    const ownerCount = [root.documentTemplateFieldId, root.packetTemplateDocumentId, root.validationRuleId].filter(Boolean).length
    if (ownerCount === 0) errors.push({ type: "ownerless_root_group", groupId: root.id, message: "Root group has no owner" })
    if (ownerCount > 1) errors.push({ type: "multiple_owners", groupId: root.id, message: "Root group has more than one owner set" })

    if (root.conditions.length === 0 && root.childGroups.length === 0) {
      errors.push({ type: "empty_group", groupId: root.id, message: "Group has no conditions or subgroups" })
    }

    for (const condition of root.conditions) await checkCondition(condition, root.id)

    for (const child of root.childGroups) {
      if (child.parentGroupId !== root.id) errors.push({ type: "owner_mismatch", groupId: child.id, message: "Child group's parent does not match its expected root" })
      if (child.documentTemplateFieldId || child.packetTemplateDocumentId || child.validationRuleId) {
        errors.push({ type: "owner_mismatch", groupId: child.id, message: "Nested group must not have its own owner" })
      }
      if (child.conditions.length === 0 && child.childGroups.length === 0) {
        errors.push({ type: "empty_group", groupId: child.id, message: "Group has no conditions or subgroups" })
      }
      if (child.childGroups.length > 0) {
        errors.push({ type: "excessive_nesting", groupId: child.id, message: "Nesting exceeds the maximum depth of 2" })
      }
      for (const condition of child.conditions) await checkCondition(condition, child.id)
    }
  }

  return { valid: errors.length === 0, errors }
}
