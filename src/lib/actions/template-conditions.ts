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
import { findInclusionCycle, type InclusionEdge } from "@/lib/conditions/inclusion-cycles"
import type { ConditionOperator, ConditionSourceType } from "@/lib/conditions/types"
import { UserRole, Prisma, type ConditionPurpose } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

// Step 4b — which ConditionPurpose values a given owner type may use. Field-
// owned conditions may never reference other documents (DocumentTemplate is
// reusable across packet templates, so there's no stable packet-template
// context to anchor a cross-document reference to) — permanent, not a
// Step-4b-only restriction. Document-owned conditions get the two purposes
// that decide packet composition itself.
const FIELD_OWNER_PURPOSES = ["FIELD_VISIBILITY", "FIELD_REQUIREDNESS"] as const
const DOCUMENT_OWNER_PURPOSES = ["DOCUMENT_INCLUSION", "DOCUMENT_REQUIREDNESS"] as const

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

// ── Owner resolution — field-owned (Step 4a) ──
async function getFieldOwnerContext(documentTemplateFieldId: string) {
  const field = await prisma.documentTemplateField.findUnique({
    where: { id: documentTemplateFieldId },
    include: { documentTemplate: { select: { id: true, organizationId: true, status: true } } },
  })
  if (!field) return null
  return { field, template: field.documentTemplate }
}

// ── Owner resolution — document-owned (Step 4b) ──
async function getDocumentOwnerContext(packetTemplateDocumentId: string) {
  const mapping = await prisma.packetTemplateDocument.findUnique({
    where: { id: packetTemplateDocumentId },
    include: {
      packetTemplate: { select: { id: true, organizationId: true } },
      documentTemplate: { select: { id: true, organizationId: true, status: true } },
    },
  })
  if (!mapping) return null
  return { mapping, packetTemplate: mapping.packetTemplate, documentTemplate: mapping.documentTemplate }
}

type FieldOwnerContext = NonNullable<Awaited<ReturnType<typeof getFieldOwnerContext>>>
type DocumentOwnerContext = NonNullable<Awaited<ReturnType<typeof getDocumentOwnerContext>>>
type RootOwnerContext = { kind: "field"; owner: FieldOwnerContext } | { kind: "document"; owner: DocumentOwnerContext }

function ownerOrganizationId(owner: RootOwnerContext): string {
  return owner.kind === "field" ? owner.owner.template.organizationId : owner.owner.packetTemplate.organizationId
}

function ownerIsRetired(owner: RootOwnerContext): boolean {
  return owner.kind === "field" ? owner.owner.template.status === "retired" : owner.owner.documentTemplate.status === "retired"
}

// Safe-metadata-only audit fields — never comparison values, field values,
// client data, PDF content, or document titles.
function ownerAuditMetadata(owner: RootOwnerContext): Record<string, unknown> {
  return owner.kind === "field"
    ? { documentTemplateId: owner.owner.template.id, ownerFieldKey: owner.owner.field.fieldKey }
    : { packetTemplateId: owner.owner.packetTemplate.id, packetTemplateDocumentId: owner.owner.mapping.id }
}

function ownerRevalidatePaths(owner: RootOwnerContext): string[] {
  return owner.kind === "field" ? [`/templates/${owner.owner.template.id}/fields`] : []
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

/** Resolves either owner type from any group in the tree (root or nested). */
async function getRootOwnerContext(groupId: string): Promise<RootOwnerContext | null> {
  const root = await resolveRootGroup(groupId)
  if (!root) return null
  if (root.documentTemplateFieldId) {
    const owner = await getFieldOwnerContext(root.documentTemplateFieldId)
    if (!owner) return null
    return { kind: "field", owner }
  }
  if (root.packetTemplateDocumentId) {
    const owner = await getDocumentOwnerContext(root.packetTemplateDocumentId)
    if (!owner) return null
    return { kind: "document", owner }
  }
  return null
}

// The pre-check in each create action is a check-then-act race — two
// concurrent requests can both pass it before either commits. The DB's own
// (documentTemplateFieldId|packetTemplateDocumentId|validationRuleId, purpose)
// unique index is the real guard; this just turns its P2002 into the same
// clean error shape the pre-check already returns, instead of an unhandled
// Prisma exception.
function isDuplicateRootGroupError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002"
}

async function rootPurposeAlreadyExists(owner: "field" | "document", ownerId: string, purpose: ConditionPurpose): Promise<boolean> {
  const existing = await prisma.templateConditionGroup.findFirst({
    where: owner === "field"
      ? { documentTemplateFieldId: ownerId, purpose }
      : { packetTemplateDocumentId: ownerId, purpose },
    select: { id: true },
  })
  return Boolean(existing)
}

// ── Root group: create (field-owned) ──
export async function createRootConditionGroup(documentTemplateFieldId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createRootConditionGroupSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  if (!(FIELD_OWNER_PURPOSES as readonly string[]).includes(data.purpose)) {
    return { success: false, error: `Purpose ${data.purpose} is not valid for a field-owned condition group` }
  }

  const owner = await getFieldOwnerContext(documentTemplateFieldId)
  if (!owner) return { success: false, error: "Field not found" }
  await requireOrgAccess(owner.template.organizationId)
  if (owner.template.status === "retired") return { success: false, error: "Retired templates cannot be edited" }
  if (await rootPurposeAlreadyExists("field", documentTemplateFieldId, data.purpose)) {
    return { success: false, error: `A ${data.purpose} root group already exists for this field` }
  }

  let group
  try {
    group = await prisma.templateConditionGroup.create({
      data: {
        organizationId: owner.template.organizationId,
        purpose: data.purpose,
        logicOperator: data.logicOperator,
        documentTemplateFieldId,
      },
    })
  } catch (error) {
    if (isDuplicateRootGroupError(error)) return { success: false, error: `A ${data.purpose} root group already exists for this field` }
    throw error
  }

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

// ── Root group: create (document-owned — Step 4b) ──
export async function createRootConditionGroupForDocument(packetTemplateDocumentId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createRootConditionGroupSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  if (!(DOCUMENT_OWNER_PURPOSES as readonly string[]).includes(data.purpose)) {
    return { success: false, error: `Purpose ${data.purpose} is not valid for a document-owned condition group` }
  }

  const owner = await getDocumentOwnerContext(packetTemplateDocumentId)
  if (!owner) return { success: false, error: "Document mapping not found" }
  await requireOrgAccess(owner.packetTemplate.organizationId)
  if (owner.documentTemplate.status === "retired") return { success: false, error: "Retired templates cannot be edited" }
  if (await rootPurposeAlreadyExists("document", packetTemplateDocumentId, data.purpose)) {
    return { success: false, error: `A ${data.purpose} root group already exists for this document mapping` }
  }

  let group
  try {
    group = await prisma.templateConditionGroup.create({
      data: {
        organizationId: owner.packetTemplate.organizationId,
        purpose: data.purpose,
        logicOperator: data.logicOperator,
        packetTemplateDocumentId,
      },
    })
  } catch (error) {
    if (isDuplicateRootGroupError(error)) return { success: false, error: `A ${data.purpose} root group already exists for this document mapping` }
    throw error
  }

  await createAuditEvent({
    organizationId: owner.packetTemplate.organizationId,
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_CREATED",
    targetType: "template_condition_group",
    targetId: group.id,
    metadata: { packetTemplateId: owner.packetTemplate.id, packetTemplateDocumentId, conditionGroupId: group.id, purpose: group.purpose, action: "group_created" },
  })
  return { success: true, data: { id: group.id } }
}

// ── Nested group: create (max depth 2 — parent must itself be a root group, either owner type) ──
export async function createNestedConditionGroup(parentGroupId: string, raw: Record<string, unknown>): Promise<ActionResult<{ id: string }>> {
  const parsed = validate(createNestedConditionGroupSchema, raw)
  if (!parsed.success) return { success: false, error: parsed.error }
  const data = parsed.data

  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const parent = await prisma.templateConditionGroup.findUnique({ where: { id: parentGroupId } })
  if (!parent) return { success: false, error: "Parent group not found" }
  if (parent.parentGroupId) return { success: false, error: "Maximum nesting depth (2) exceeded" }
  if (!parent.documentTemplateFieldId && !parent.packetTemplateDocumentId) {
    return { success: false, error: "Parent group has no owner" }
  }

  const owner: RootOwnerContext | null = parent.documentTemplateFieldId
    ? await (async () => {
        const o = await getFieldOwnerContext(parent.documentTemplateFieldId as string)
        return o ? ({ kind: "field", owner: o } as RootOwnerContext) : null
      })()
    : await (async () => {
        const o = await getDocumentOwnerContext(parent.packetTemplateDocumentId as string)
        return o ? ({ kind: "document", owner: o } as RootOwnerContext) : null
      })()
  if (!owner) return { success: false, error: "Parent group's owner not found" }
  await requireOrgAccess(ownerOrganizationId(owner))
  if (ownerIsRetired(owner)) return { success: false, error: "Retired templates cannot be edited" }

  const group = await prisma.templateConditionGroup.create({
    data: {
      organizationId: ownerOrganizationId(owner),
      purpose: parent.purpose,
      logicOperator: data.logicOperator,
      parentGroupId,
      // Nested groups never carry their own owner — they belong to the root's owner.
    },
  })

  await createAuditEvent({
    organizationId: ownerOrganizationId(owner),
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_CREATED",
    targetType: "template_condition_group",
    targetId: group.id,
    metadata: { ...ownerAuditMetadata(owner), conditionGroupId: group.id, purpose: group.purpose, action: "nested_group_created" },
  })
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path)
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
  const owner = await getRootOwnerContext(groupId)
  if (!owner) return { success: false, error: "Group not found" }
  await requireOrgAccess(ownerOrganizationId(owner))
  if (ownerIsRetired(owner)) return { success: false, error: "Retired templates cannot be edited" }

  await prisma.templateConditionGroup.update({ where: { id: groupId }, data: { logicOperator: data.logicOperator } })

  await createAuditEvent({
    organizationId: ownerOrganizationId(owner),
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_UPDATED",
    targetType: "template_condition_group",
    targetId: groupId,
    metadata: { ...ownerAuditMetadata(owner), conditionGroupId: groupId, purpose: group.purpose, action: "group_logic_operator_updated" },
  })
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path)
  return { success: true, data: { id: groupId } }
}

// ── Group: delete (cascades to its conditions and any nested child group) ──
export async function deleteConditionGroup(groupId: string): Promise<ActionResult<{ id: string }>> {
  const auth1 = await requireStaffManager()
  if (!auth1.success) return auth1

  const group = await prisma.templateConditionGroup.findUnique({ where: { id: groupId } })
  if (!group) return { success: false, error: "Group not found" }
  const owner = await getRootOwnerContext(groupId)
  if (!owner) return { success: false, error: "Group not found" }
  await requireOrgAccess(ownerOrganizationId(owner))
  if (ownerIsRetired(owner)) return { success: false, error: "Retired templates cannot be edited" }

  await prisma.templateConditionGroup.delete({ where: { id: groupId } })

  await createAuditEvent({
    organizationId: ownerOrganizationId(owner),
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_DELETED",
    targetType: "template_condition_group",
    targetId: groupId,
    metadata: { ...ownerAuditMetadata(owner), conditionGroupId: groupId, purpose: group.purpose, action: "group_deleted" },
  })
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path)
  return { success: true, data: { id: groupId } }
}

type ConditionSourceResolution =
  | { ok: true; resolvedFieldKey: string | null; resolvedMappingId: string | null; fieldType?: string }
  | { ok: false; error: string }

// Field-owned: same-document-only, permanently — see FIELD_OWNER_PURPOSES comment above.
async function resolveFieldOwnedConditionSource(
  organizationId: string,
  documentTemplateId: string,
  sourceType: ConditionSourceType,
  sourceFieldKey: string | undefined,
  sourcePacketTemplateDocumentId: string | undefined
): Promise<ConditionSourceResolution> {
  if (sourcePacketTemplateDocumentId) {
    return { ok: false, error: "Field-owned conditions must not reference sourcePacketTemplateDocumentId" }
  }
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
    return { ok: true, resolvedFieldKey: sourceFieldKey, resolvedMappingId: null, fieldType: field.fieldType }
  }
  // Pseudo-fields never carry a sourceFieldKey.
  if (sourceFieldKey) return { ok: false, error: `${sourceType} must not include a sourceFieldKey` }
  return { ok: true, resolvedFieldKey: null, resolvedMappingId: null }
}

// Document-owned (Step 4b): TEMPLATE_FIELD may reference the owner mapping's
// own document, or a sibling mapping's document — both must belong to the
// same PacketTemplate as the owner. sourcePacketTemplateDocumentId is the
// disambiguation anchor since fieldKey alone is not unique across documents.
async function resolveDocumentOwnedConditionSource(
  organizationId: string,
  packetTemplateId: string,
  sourceType: ConditionSourceType,
  sourceFieldKey: string | undefined,
  sourcePacketTemplateDocumentId: string | undefined
): Promise<ConditionSourceResolution> {
  if (sourceType === "TEMPLATE_FIELD") {
    if (!sourceFieldKey) return { ok: false, error: "sourceFieldKey is required for TEMPLATE_FIELD conditions" }
    if (!sourcePacketTemplateDocumentId) {
      return { ok: false, error: "sourcePacketTemplateDocumentId is required for TEMPLATE_FIELD conditions on document-owned groups" }
    }
    const mapping = await prisma.packetTemplateDocument.findUnique({
      where: { id: sourcePacketTemplateDocumentId },
      include: { packetTemplate: { select: { id: true, organizationId: true } } },
    })
    // Cross-tenant attempts are reported identically to "not found" — never
    // confirm existence of a mapping outside the caller's organization.
    if (!mapping || mapping.packetTemplate.organizationId !== organizationId) {
      return { ok: false, error: "Referenced document mapping not found" }
    }
    if (mapping.packetTemplate.id !== packetTemplateId) {
      return { ok: false, error: "Referenced document mapping belongs to a different packet template" }
    }
    const field = await prisma.documentTemplateField.findUnique({
      where: { documentTemplateId_fieldKey: { documentTemplateId: mapping.documentTemplateId, fieldKey: sourceFieldKey } },
    })
    if (!field) {
      const elsewhere = await prisma.documentTemplateField.findFirst({ where: { organizationId, fieldKey: sourceFieldKey, documentTemplateId: { not: mapping.documentTemplateId } } })
      return { ok: false, error: elsewhere ? "Field belongs to a different document" : "Field not found on the referenced document" }
    }
    return { ok: true, resolvedFieldKey: sourceFieldKey, resolvedMappingId: sourcePacketTemplateDocumentId, fieldType: field.fieldType }
  }
  // Pseudo-fields never carry a sourceFieldKey or a cross-document anchor.
  if (sourceFieldKey || sourcePacketTemplateDocumentId) {
    return { ok: false, error: `${sourceType} must not include a sourceFieldKey or sourcePacketTemplateDocumentId` }
  }
  return { ok: true, resolvedFieldKey: null, resolvedMappingId: null }
}

async function validateOperatorAndValue(
  owner: RootOwnerContext,
  sourceType: ConditionSourceType,
  sourceFieldKey: string | undefined,
  sourcePacketTemplateDocumentId: string | undefined,
  operator: ConditionOperator,
  comparisonValue: unknown
): Promise<ConditionSourceResolution> {
  const sourceResult =
    owner.kind === "field"
      ? await resolveFieldOwnedConditionSource(owner.owner.template.organizationId, owner.owner.template.id, sourceType, sourceFieldKey, sourcePacketTemplateDocumentId)
      : await resolveDocumentOwnedConditionSource(owner.owner.packetTemplate.organizationId, owner.owner.packetTemplate.id, sourceType, sourceFieldKey, sourcePacketTemplateDocumentId)
  if (!sourceResult.ok) return sourceResult

  const kind = resolveCompatibilityKind(sourceType, sourceResult.fieldType)
  if (!kind || !isOperatorCompatible(operator, kind)) {
    return { ok: false, error: `Operator ${operator} is not valid for this field type` }
  }

  const shapeCheck = validateComparisonValueShape(operator, comparisonValue)
  if (!shapeCheck.valid) return { ok: false, error: shapeCheck.error }

  return sourceResult
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
  const owner = await getRootOwnerContext(groupId)
  if (!owner) return { success: false, error: "Group not found" }
  await requireOrgAccess(ownerOrganizationId(owner))
  if (ownerIsRetired(owner)) return { success: false, error: "Retired templates cannot be edited" }

  const check = await validateOperatorAndValue(owner, data.sourceType, data.sourceFieldKey, data.sourcePacketTemplateDocumentId, data.operator, data.comparisonValue)
  if (!check.ok) return { success: false, error: check.error }

  const condition = await prisma.templateCondition.create({
    data: {
      groupId,
      sourceType: data.sourceType,
      sourceFieldKey: check.resolvedFieldKey,
      sourcePacketTemplateDocumentId: check.resolvedMappingId,
      operator: data.operator,
      comparisonValue: (data.comparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      sortOrder: data.sortOrder,
    },
  })

  await createAuditEvent({
    organizationId: ownerOrganizationId(owner),
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_CREATED",
    targetType: "template_condition",
    targetId: condition.id,
    metadata: { ...ownerAuditMetadata(owner), conditionGroupId: groupId, conditionId: condition.id, purpose: group.purpose, action: "condition_created" },
  })
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path)
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
  const owner = await getRootOwnerContext(existing.groupId)
  if (!owner) return { success: false, error: "Condition not found" }
  await requireOrgAccess(ownerOrganizationId(owner))
  if (ownerIsRetired(owner)) return { success: false, error: "Retired templates cannot be edited" }

  const mergedSourceType = data.sourceType ?? (existing.sourceType as ConditionSourceType)
  const mergedSourceFieldKey = data.sourceFieldKey !== undefined ? data.sourceFieldKey : existing.sourceFieldKey ?? undefined
  const mergedSourcePacketTemplateDocumentId =
    data.sourcePacketTemplateDocumentId !== undefined ? data.sourcePacketTemplateDocumentId : existing.sourcePacketTemplateDocumentId ?? undefined
  const mergedOperator = data.operator ?? (existing.operator as ConditionOperator)
  const mergedComparisonValue = data.comparisonValue !== undefined ? data.comparisonValue : existing.comparisonValue

  const check = await validateOperatorAndValue(owner, mergedSourceType, mergedSourceFieldKey, mergedSourcePacketTemplateDocumentId, mergedOperator, mergedComparisonValue)
  if (!check.ok) return { success: false, error: check.error }

  await prisma.templateCondition.update({
    where: { id: conditionId },
    data: {
      sourceType: mergedSourceType,
      sourceFieldKey: check.resolvedFieldKey,
      sourcePacketTemplateDocumentId: check.resolvedMappingId,
      operator: mergedOperator,
      comparisonValue: (mergedComparisonValue ?? Prisma.JsonNull) as Prisma.InputJsonValue,
      ...(data.sortOrder !== undefined && { sortOrder: data.sortOrder }),
    },
  })

  await createAuditEvent({
    organizationId: ownerOrganizationId(owner),
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_UPDATED",
    targetType: "template_condition",
    targetId: conditionId,
    metadata: { ...ownerAuditMetadata(owner), conditionGroupId: existing.groupId, conditionId, purpose: group.purpose, action: "condition_updated" },
  })
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path)
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
  const owner = await getRootOwnerContext(existing.groupId)
  if (!owner) return { success: false, error: "Condition not found" }
  await requireOrgAccess(ownerOrganizationId(owner))
  if (ownerIsRetired(owner)) return { success: false, error: "Retired templates cannot be edited" }

  await prisma.templateCondition.delete({ where: { id: conditionId } })

  await createAuditEvent({
    organizationId: ownerOrganizationId(owner),
    actorId: auth1.user.id as string,
    action: "TEMPLATE_CONDITION_DELETED",
    targetType: "template_condition",
    targetId: conditionId,
    metadata: { ...ownerAuditMetadata(owner), conditionGroupId: existing.groupId, conditionId, purpose: group.purpose, action: "condition_deleted" },
  })
  for (const path of ownerRevalidatePaths(owner)) revalidatePath(path)
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

// ── Read: full condition tree owned by one PacketTemplateDocument mapping — Step 4b, reads allowed on retired templates ──
export async function getConditionsForPacketTemplateDocument(packetTemplateDocumentId: string) {
  const mapping = await prisma.packetTemplateDocument.findUnique({
    where: { id: packetTemplateDocumentId },
    include: { packetTemplate: { select: { organizationId: true } } },
  })
  if (!mapping) throw new Error("Document mapping not found")
  await requireOrgAccess(mapping.packetTemplate.organizationId)

  return prisma.templateConditionGroup.findMany({
    where: { packetTemplateDocumentId },
    include: {
      conditions: { orderBy: { sortOrder: "asc" } },
      childGroups: { include: { conditions: { orderBy: { sortOrder: "asc" } } } },
    },
  })
}

export interface FieldConditionDependencySummary {
  count: number
  purposes: string[]
  // Step 4b — PacketTemplates containing a document-owned condition that
  // cross-document-references this field. Empty when only same-template
  // field-owned conditions depend on it (Step 4a behavior, unchanged).
  affectedPacketTemplateIds: string[]
}

// ── Dependency lookup — reused by document-template-fields.ts to block delete/rename ──
// Step 4b: extended organization-wide to also catch document-owned
// (PacketTemplateDocument-owned) conditions elsewhere in the org whose
// cross-document TEMPLATE_FIELD reference points at this field, not just
// same-template field-owned conditions.
export async function getFieldConditionDependencySummary(documentTemplateId: string, fieldKey: string): Promise<FieldConditionDependencySummary> {
  const template = await prisma.documentTemplate.findUnique({ where: { id: documentTemplateId } })
  if (!template) throw new Error("Template not found")
  await requireOrgAccess(template.organizationId)

  const fieldIds = (await prisma.documentTemplateField.findMany({ where: { documentTemplateId }, select: { id: true } })).map((f) => f.id)

  const sameTemplateConditions =
    fieldIds.length === 0
      ? []
      : await prisma.templateCondition.findMany({
          where: {
            sourceType: "TEMPLATE_FIELD",
            sourceFieldKey: fieldKey,
            sourcePacketTemplateDocumentId: null,
            group: {
              OR: [{ documentTemplateFieldId: { in: fieldIds } }, { parentGroup: { documentTemplateFieldId: { in: fieldIds } } }],
            },
          },
          include: { group: { select: { purpose: true } } },
        })

  const crossDocConditions = await prisma.templateCondition.findMany({
    where: {
      sourceType: "TEMPLATE_FIELD",
      sourceFieldKey: fieldKey,
      sourcePacketTemplateDocument: { documentTemplateId },
    },
    include: {
      group: { select: { purpose: true, packetTemplateDocumentId: true, parentGroup: { select: { packetTemplateDocumentId: true } } } },
    },
  })

  const crossDocMappingIds = Array.from(
    new Set(
      crossDocConditions
        .map((c) => c.group.packetTemplateDocumentId ?? c.group.parentGroup?.packetTemplateDocumentId ?? null)
        .filter((id): id is string => id !== null)
    )
  )
  const owningMappings =
    crossDocMappingIds.length === 0
      ? []
      : await prisma.packetTemplateDocument.findMany({ where: { id: { in: crossDocMappingIds } }, select: { id: true, packetTemplateId: true } })
  const packetTemplateIdByMappingId = new Map(owningMappings.map((m) => [m.id, m.packetTemplateId]))

  const affectedPacketTemplateIds = Array.from(
    new Set(
      crossDocConditions
        .map((c) => {
          const mappingId = c.group.packetTemplateDocumentId ?? c.group.parentGroup?.packetTemplateDocumentId ?? null
          return mappingId ? (packetTemplateIdByMappingId.get(mappingId) ?? null) : null
        })
        .filter((id): id is string => id !== null)
    )
  )

  const allConditions = [...sameTemplateConditions, ...crossDocConditions]
  return {
    count: allConditions.length,
    purposes: Array.from(new Set(allConditions.map((c) => c.group.purpose))),
    affectedPacketTemplateIds,
  }
}

export interface PacketTemplateDocumentConditionDependencies {
  ownedConditionCount: number
  incomingReferenceCount: number
  totalCount: number
  packetTemplateId: string
  purposes: string[]
}

// ── Dependency lookup for a PacketTemplateDocument mapping — reusable helper
// for a future mapping-deletion feature (not built in Step 4b). Reports both
// conditions the mapping itself owns, and conditions owned by sibling
// mappings that cross-document-reference this one. ──
export async function getPacketTemplateDocumentConditionDependencies(packetTemplateDocumentId: string): Promise<PacketTemplateDocumentConditionDependencies> {
  const mapping = await prisma.packetTemplateDocument.findUnique({
    where: { id: packetTemplateDocumentId },
    include: { packetTemplate: { select: { id: true, organizationId: true } } },
  })
  if (!mapping) throw new Error("Document mapping not found")
  await requireOrgAccess(mapping.packetTemplate.organizationId)

  const ownedConditions = await prisma.templateCondition.findMany({
    where: {
      group: { OR: [{ packetTemplateDocumentId }, { parentGroup: { packetTemplateDocumentId } }] },
    },
    include: { group: { select: { purpose: true } } },
  })

  const incomingConditions = await prisma.templateCondition.findMany({
    where: { sourcePacketTemplateDocumentId: packetTemplateDocumentId },
    include: { group: { select: { purpose: true } } },
  })

  const allConditions = [...ownedConditions, ...incomingConditions]
  return {
    ownedConditionCount: ownedConditions.length,
    incomingReferenceCount: incomingConditions.length,
    totalCount: allConditions.length,
    packetTemplateId: mapping.packetTemplate.id,
    purposes: Array.from(new Set(allConditions.map((c) => c.group.purpose))),
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
    | "duplicate_root_group"
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
  const rootPurposeCounts = new Map<string, number>()
  for (const root of rootGroups) {
    if (!root.documentTemplateFieldId) continue
    const key = `${root.documentTemplateFieldId}:${root.purpose}`
    rootPurposeCounts.set(key, (rootPurposeCounts.get(key) ?? 0) + 1)
  }

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
    if (root.documentTemplateFieldId && (rootPurposeCounts.get(`${root.documentTemplateFieldId}:${root.purpose}`) ?? 0) > 1) {
      errors.push({ type: "duplicate_root_group", groupId: root.id, message: `More than one ${root.purpose} root group exists for this field` })
    }
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

export interface PacketTemplateConditionValidationError {
  type:
    | "invalid_owner_purpose"
    | "ownerless_root_group"
    | "multiple_owners"
    | "nonexistent_source_mapping"
    | "source_mapping_outside_packet_template"
    | "nonexistent_field_key"
    | "field_wrong_document"
    | "invalid_operator_for_type"
    | "malformed_comparison_value"
    | "excessive_nesting"
    | "circular_group"
    | "inclusion_cycle"
    | "empty_group"
    | "orphan_nested_group"
    | "duplicate_root_group"
  groupId?: string
  conditionId?: string
  packetTemplateDocumentIds?: string[]
  message: string
}

// ── Full consistency check for a PacketTemplate's document-owned conditions (Step 4b) ──
// PacketTemplate has no draft/active/retired publish lifecycle today (unlike
// DocumentTemplate) — there is nothing to gate here yet. This validator is
// exposed as a standalone, callable check; it must be invoked explicitly
// before a packet template is relied on (e.g. before any future runtime
// materialization work in Step 4c) rather than being wired into an
// activation step that does not exist.
export async function validatePacketTemplateConditions(packetTemplateId: string): Promise<{ valid: boolean; errors: PacketTemplateConditionValidationError[] }> {
  const packetTemplate = await prisma.packetTemplate.findUnique({ where: { id: packetTemplateId } })
  if (!packetTemplate) throw new Error("Packet template not found")
  await requireOrgAccess(packetTemplate.organizationId)

  const mappings = await prisma.packetTemplateDocument.findMany({
    where: { packetTemplateId },
    select: { id: true, documentTemplateId: true },
  })
  const errors: PacketTemplateConditionValidationError[] = []
  if (mappings.length === 0) return { valid: true, errors }

  const mappingIds = mappings.map((m) => m.id)
  const mappingById = new Map(mappings.map((m) => [m.id, m]))

  // fieldKey -> fieldType, scoped per documentTemplateId, across every
  // document mapped into this packet template.
  const documentTemplateIds = Array.from(new Set(mappings.map((m) => m.documentTemplateId)))
  const allFields = await prisma.documentTemplateField.findMany({
    where: { documentTemplateId: { in: documentTemplateIds } },
    select: { documentTemplateId: true, fieldKey: true, fieldType: true },
  })
  const fieldTypeByDocAndKey = new Map(allFields.map((f) => [`${f.documentTemplateId}:${f.fieldKey}`, f.fieldType]))

  const rootGroups = await prisma.templateConditionGroup.findMany({
    where: { packetTemplateDocumentId: { in: mappingIds } },
    include: {
      conditions: true,
      childGroups: { include: { conditions: true, childGroups: true } },
    },
  })
  const rootPurposeCounts = new Map<string, number>()
  for (const root of rootGroups) {
    if (!root.packetTemplateDocumentId) continue
    const key = `${root.packetTemplateDocumentId}:${root.purpose}`
    rootPurposeCounts.set(key, (rootPurposeCounts.get(key) ?? 0) + 1)
  }

  const inclusionEdges: InclusionEdge[] = []

  async function checkCondition(
    condition: { id: string; sourceType: string; sourceFieldKey: string | null; sourcePacketTemplateDocumentId: string | null; operator: string; comparisonValue: unknown },
    groupId: string,
    ownerMappingId: string,
    groupPurpose: string
  ) {
    let fieldType: string | undefined

    if (condition.sourceType === "TEMPLATE_FIELD") {
      if (!condition.sourceFieldKey || !condition.sourcePacketTemplateDocumentId) {
        errors.push({ type: "nonexistent_source_mapping", groupId, conditionId: condition.id, message: "TEMPLATE_FIELD condition is missing its sourcePacketTemplateDocumentId" })
        return
      }
      const referencedMapping = mappingById.get(condition.sourcePacketTemplateDocumentId)
      if (!referencedMapping) {
        // Could exist in the org but outside this packet template, or not exist at all — both are invalid here either way.
        errors.push({
          type: "nonexistent_source_mapping",
          groupId, conditionId: condition.id,
          packetTemplateDocumentIds: [condition.sourcePacketTemplateDocumentId],
          message: `References document mapping "${condition.sourcePacketTemplateDocumentId}" not found in this packet template`,
        })
        return
      }

      // A structural document-to-document dependency exists regardless of
      // whether the fieldKey itself turns out to be valid — cycles are a
      // document-level risk, not a field-level one.
      if (groupPurpose === "DOCUMENT_INCLUSION") {
        inclusionEdges.push({ fromMappingId: ownerMappingId, toMappingId: referencedMapping.id, conditionId: condition.id })
      }

      fieldType = fieldTypeByDocAndKey.get(`${referencedMapping.documentTemplateId}:${condition.sourceFieldKey}`)
      if (fieldType === undefined) {
        const elsewhere = await prisma.documentTemplateField.findFirst({
          where: { organizationId: packetTemplate!.organizationId, fieldKey: condition.sourceFieldKey, documentTemplateId: { not: referencedMapping.documentTemplateId } },
        })
        errors.push({
          type: elsewhere ? "field_wrong_document" : "nonexistent_field_key",
          groupId, conditionId: condition.id,
          message: elsewhere
            ? `References field "${condition.sourceFieldKey}" that exists on a different document`
            : `References unknown field key "${condition.sourceFieldKey}"`,
        })
        return
      }
    }

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
    if (root.packetTemplateDocumentId && (rootPurposeCounts.get(`${root.packetTemplateDocumentId}:${root.purpose}`) ?? 0) > 1) {
      errors.push({ type: "duplicate_root_group", groupId: root.id, message: `More than one ${root.purpose} root group exists for this document mapping` })
    }
    if (root.parentGroupId === root.id) errors.push({ type: "circular_group", groupId: root.id, message: "Group references itself as its own parent" })

    const ownerCount = [root.documentTemplateFieldId, root.packetTemplateDocumentId, root.validationRuleId].filter(Boolean).length
    if (ownerCount === 0) errors.push({ type: "ownerless_root_group", groupId: root.id, message: "Root group has no owner" })
    if (ownerCount > 1) errors.push({ type: "multiple_owners", groupId: root.id, message: "Root group has more than one owner set" })

    if (!(DOCUMENT_OWNER_PURPOSES as readonly string[]).includes(root.purpose)) {
      errors.push({ type: "invalid_owner_purpose", groupId: root.id, message: `Purpose ${root.purpose} is not valid for a document-owned condition group` })
    }

    if (root.conditions.length === 0 && root.childGroups.length === 0) {
      errors.push({ type: "empty_group", groupId: root.id, message: "Group has no conditions or subgroups" })
    }

    const ownerMappingId = root.packetTemplateDocumentId as string
    for (const condition of root.conditions) await checkCondition(condition, root.id, ownerMappingId, root.purpose)

    for (const child of root.childGroups) {
      if (child.parentGroupId !== root.id) errors.push({ type: "orphan_nested_group", groupId: child.id, message: "Child group's parent does not match its expected root" })
      if (child.documentTemplateFieldId || child.packetTemplateDocumentId || child.validationRuleId) {
        errors.push({ type: "orphan_nested_group", groupId: child.id, message: "Nested group must not have its own owner" })
      }
      if (child.conditions.length === 0 && child.childGroups.length === 0) {
        errors.push({ type: "empty_group", groupId: child.id, message: "Group has no conditions or subgroups" })
      }
      if (child.childGroups.length > 0) {
        errors.push({ type: "excessive_nesting", groupId: child.id, message: "Nesting exceeds the maximum depth of 2" })
      }
      for (const condition of child.conditions) await checkCondition(condition, child.id, ownerMappingId, root.purpose)
    }
  }

  const cycleResult = findInclusionCycle(inclusionEdges)
  if (cycleResult.hasCycle) {
    errors.push({
      type: "inclusion_cycle",
      packetTemplateDocumentIds: cycleResult.cycle,
      message: `Circular document-inclusion dependency: ${cycleResult.cycle.join(" -> ")}`,
    })
  }

  return { valid: errors.length === 0, errors }
}
