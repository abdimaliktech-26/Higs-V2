import "server-only"

import { auth } from "@/lib/auth"
import { createAuditEvent } from "@/lib/audit"
import { prisma } from "@/lib/db"
import { requireOrgAccess } from "@/lib/permissions"
import type { Prisma } from "@prisma/client"
import { validatePacketTemplateConditions, validateTemplateConditions } from "@/lib/actions/template-conditions"
import { evaluateConditionTree } from "./evaluator"
import type { EvaluationContext, EvaluationGroup, GroupEvaluationDetail } from "./types"
import {
  CONDITION_RUNTIME_VERSION,
  type PacketConditionDefinition,
  type PacketConditionRuntime,
  type RuntimeEvaluation,
  type RuntimeIntegrityError,
  type SnapshotGroup,
  type SnapshotMapping,
} from "./runtime-types"

function deriveIsMinor(dateOfBirth: Date | null, referenceAt: Date): boolean {
  if (!dateOfBirth) return false
  let age = referenceAt.getUTCFullYear() - dateOfBirth.getUTCFullYear()
  const beforeBirthday = referenceAt.getUTCMonth() < dateOfBirth.getUTCMonth()
    || (referenceAt.getUTCMonth() === dateOfBirth.getUTCMonth() && referenceAt.getUTCDate() < dateOfBirth.getUTCDate())
  if (beforeBirthday) age--
  return age < 18
}

function normalizeGroup(group: any): SnapshotGroup {
  return {
    id: group.id,
    purpose: group.purpose,
    logicOperator: group.logicOperator,
    conditions: [...group.conditions]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((condition) => ({
        sourceType: condition.sourceType,
        sourceFieldKey: condition.sourceFieldKey,
        sourcePacketTemplateDocumentId: condition.sourcePacketTemplateDocumentId,
        operator: condition.operator,
        comparisonValue: condition.comparisonValue,
      })),
    childGroups: [...group.childGroups].map(normalizeGroup),
  }
}

function isDefinition(value: unknown): value is PacketConditionDefinition {
  if (!value || typeof value !== "object") return false
  const candidate = value as Partial<PacketConditionDefinition>
  return candidate.schemaVersion === 1 && typeof candidate.packetTemplateId === "string" && Array.isArray(candidate.mappings)
}

async function requireAuthorizedPacket(packetId: string) {
  const session = await auth()
  if (!session?.user) throw new Error("Unauthorized")
  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    include: {
      client: { select: { organizationId: true, dateOfBirth: true } },
      program: { select: { code: true, organizationId: true } },
      packetTemplate: { select: { id: true, organizationId: true } },
    },
  })
  if (!packet) throw new Error("Packet not found")
  await requireOrgAccess(packet.organizationId)
  if (packet.client.organizationId !== packet.organizationId) throw new Error("Packet/client organization mismatch")
  if (!packet.packetTemplate || packet.packetTemplate.organizationId !== packet.organizationId) throw new Error("Packet/template organization mismatch")
  if (packet.program && packet.program.organizationId !== packet.organizationId) throw new Error("Packet/program organization mismatch")
  return { packet, actorId: session.user.id as string }
}

/**
 * Foundation-only snapshot primitive for Step 4c.2. No current packet-creation
 * or UI path invokes this function. The definition is inserted once and no
 * update API exists, so later template edits cannot mutate it.
 */
export async function createPacketConditionSnapshot(packetId: string) {
  const { packet, actorId } = await requireAuthorizedPacket(packetId)
  if (packet.conditionSnapshotId || packet.conditionRuntimeVersion) throw new Error("Packet already has a condition runtime snapshot")

  const packetCheck = await validatePacketTemplateConditions(packet.packetTemplate!.id)
  if (!packetCheck.valid) throw new Error(`Packet template has ${packetCheck.errors.length} invalid condition definition(s)`)

  const mappings = await prisma.packetTemplateDocument.findMany({
    where: { packetTemplateId: packet.packetTemplate!.id },
    orderBy: { sortOrder: "asc" },
    include: {
      conditionGroups: {
        where: { parentGroupId: null },
        include: { conditions: true, childGroups: { include: { conditions: true, childGroups: true } } },
      },
      documentTemplate: {
        include: {
          fields: {
            orderBy: { sortOrder: "asc" },
            include: {
              conditionGroups: {
                where: { parentGroupId: null },
                include: { conditions: true, childGroups: { include: { conditions: true, childGroups: true } } },
              },
            },
          },
        },
      },
    },
  })

  for (const mapping of mappings) {
    if (mapping.documentTemplate.organizationId !== packet.organizationId) throw new Error("Mapping/document organization mismatch")
    const check = await validateTemplateConditions(mapping.documentTemplateId)
    if (!check.valid) throw new Error(`Document template has ${check.errors.length} invalid condition definition(s)`)
  }

  const definition: PacketConditionDefinition = {
    schemaVersion: 1,
    packetTemplateId: packet.packetTemplate!.id,
    mappings: mappings.map((mapping): SnapshotMapping => ({
      id: mapping.id,
      documentTemplateId: mapping.documentTemplateId,
      required: mapping.required,
      sortOrder: mapping.sortOrder,
      conditionGroups: mapping.conditionGroups.map(normalizeGroup),
      fields: mapping.documentTemplate.fields.map((field) => ({
        id: field.id,
        fieldKey: field.fieldKey,
        fieldType: field.fieldType,
        isRequired: field.isRequired,
        conditionGroups: field.conditionGroups.map(normalizeGroup),
      })),
    })),
  }

  const referenceAt = packet.createdAt
  const clientIsMinor = deriveIsMinor(packet.client.dateOfBirth, referenceAt)
  return prisma.$transaction(async (tx) => {
    const current = await tx.packet.findUnique({ where: { id: packetId }, select: { conditionSnapshotId: true, conditionRuntimeVersion: true } })
    if (!current || current.conditionSnapshotId || current.conditionRuntimeVersion) throw new Error("Packet runtime state changed during snapshot creation")
    const snapshot = await tx.packetConditionSnapshot.create({
      data: {
        organizationId: packet.organizationId,
        packetTemplateId: packet.packetTemplate!.id,
        runtimeVersion: CONDITION_RUNTIME_VERSION,
        evaluationReferenceAt: referenceAt,
        clientIsMinor,
        definition: definition as unknown as Prisma.InputJsonValue,
      },
    })
    await tx.packet.update({
      where: { id: packetId },
      data: { conditionSnapshotId: snapshot.id, conditionRuntimeVersion: CONDITION_RUNTIME_VERSION },
    })
    await createAuditEvent({
      organizationId: packet.organizationId,
      actorId,
      action: "PACKET_CONDITION_SNAPSHOT_CREATED",
      targetType: "packet_condition_snapshot",
      targetId: snapshot.id,
      metadata: { packetId, packetTemplateId: packet.packetTemplate!.id, snapshotId: snapshot.id, runtimeVersion: CONDITION_RUNTIME_VERSION, action: "snapshot_created" },
    }, tx)
    return { id: snapshot.id, runtimeVersion: CONDITION_RUNTIME_VERSION }
  })
}

export async function buildPacketConditionContext(packetId: string): Promise<PacketConditionRuntime> {
  await requireAuthorizedPacket(packetId)
  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    include: {
      program: { select: { code: true } },
      conditionSnapshot: true,
      documents: { include: { fields: true } },
    },
  })
  if (!packet) throw new Error("Packet not found")

  // Mode-independent direct indexes by the row's own id — the only stable
  // identity legacy PacketDocument/PdfField rows have. Legacy requiredness
  // evaluation reads exclusively from these (never packetDocumentsByMappingId,
  // which stays empty for legacy packets since they carry no mapping id).
  const packetDocumentsById: PacketConditionRuntime["packetDocumentsById"] = {}
  const pdfFieldsById: PacketConditionRuntime["pdfFieldsById"] = {}
  for (const document of packet.documents) {
    packetDocumentsById[document.id] = {
      id: document.id,
      isRequired: document.isRequired,
      applicabilityStatus: document.applicabilityStatus,
      packetTemplateDocumentId: document.packetTemplateDocumentId,
    }
    for (const field of document.fields) {
      pdfFieldsById[field.id] = {
        id: field.id,
        packetDocumentId: document.id,
        isRequired: field.isRequired,
        templateFieldKey: field.templateFieldKey,
      }
    }
  }

  const errors: RuntimeIntegrityError[] = []
  const isLegacy = !packet.conditionSnapshotId && !packet.conditionRuntimeVersion
  if (isLegacy) {
    return {
      mode: "legacy", packetId, organizationId: packet.organizationId, packetCreatedAt: packet.createdAt,
      packetType: packet.packetType, programCode: packet.program?.code ?? null, client: { isMinor: null },
      snapshotId: null, runtimeVersion: null, definition: null, packetDocumentsByMappingId: {},
      packetDocumentsById, pdfFieldsById, documentFieldValues: {}, integrityErrors: [],
    }
  }

  if (!packet.conditionSnapshot || packet.conditionRuntimeVersion !== packet.conditionSnapshot.runtimeVersion) {
    errors.push({ type: "broken_snapshot_reference", message: "Packet condition runtime marker does not match its snapshot" })
  }
  if (packet.conditionSnapshot && packet.conditionSnapshot.organizationId !== packet.organizationId) {
    errors.push({ type: "snapshot_organization_mismatch", message: "Condition snapshot belongs to a different organization" })
  }
  const definition = packet.conditionSnapshot && isDefinition(packet.conditionSnapshot.definition) ? packet.conditionSnapshot.definition : null
  if (!definition) errors.push({ type: "malformed_snapshot", message: "Condition snapshot definition is malformed" })
  if (definition && packet.conditionSnapshot && definition.packetTemplateId !== packet.conditionSnapshot.packetTemplateId) {
    errors.push({ type: "snapshot_template_mismatch", message: "Condition snapshot template identity is inconsistent" })
  }

  const mappingByTemplate = new Map((definition?.mappings ?? []).map((mapping) => [mapping.documentTemplateId, mapping]))
  const packetDocumentsByMappingId: PacketConditionRuntime["packetDocumentsByMappingId"] = {}
  const documentFieldValues: PacketConditionRuntime["documentFieldValues"] = {}

  for (const document of packet.documents) {
    const mapping = document.packetTemplateDocumentId
      ? definition?.mappings.find((entry) => entry.id === document.packetTemplateDocumentId)
      : mappingByTemplate.get(document.documentTemplateId)
    if (!mapping) {
      errors.push({ type: "missing_mapping", message: "Packet document cannot be resolved to the snapshot", packetDocumentId: document.id })
      continue
    }
    if (mapping.documentTemplateId !== document.documentTemplateId) {
      errors.push({ type: "mapping_document_mismatch", message: "Packet document does not match its snapshot mapping", mappingId: mapping.id, packetDocumentId: document.id })
      continue
    }
    const fieldValues: Record<string, unknown> = Object.fromEntries(mapping.fields.map((field) => [field.fieldKey, null]))
    const fieldsById: Record<string, any> = {}
    for (const field of document.fields) {
      if (field.templateFieldKey) {
        const source = mapping.fields.find((entry) => entry.fieldKey === field.templateFieldKey)
        if (!source) errors.push({ type: "missing_field_key", message: "PDF field key is not present in the snapshot", mappingId: mapping.id, packetDocumentId: document.id, fieldId: field.id })
        else if (field.documentTemplateFieldId && field.documentTemplateFieldId !== source.id) errors.push({ type: "field_parent_mismatch", message: "PDF field source identity is inconsistent", mappingId: mapping.id, packetDocumentId: document.id, fieldId: field.id })
        fieldValues[field.templateFieldKey] = field.value
      }
      fieldsById[field.id] = { id: field.id, templateFieldKey: field.templateFieldKey, documentTemplateFieldId: field.documentTemplateFieldId, value: field.value, staticRequired: field.isRequired }
    }
    documentFieldValues[mapping.id] = fieldValues
    packetDocumentsByMappingId[mapping.id] = {
      id: document.id, mappingId: mapping.id, documentTemplateId: document.documentTemplateId,
      staticRequired: document.isRequired, applicabilityStatus: document.applicabilityStatus,
      fieldsById, fieldValues,
    }
  }
  for (const mapping of definition?.mappings ?? []) documentFieldValues[mapping.id] ??= Object.fromEntries(mapping.fields.map((field) => [field.fieldKey, null]))

  return {
    mode: "snapshot", packetId, organizationId: packet.organizationId, packetCreatedAt: packet.createdAt,
    packetType: packet.packetType, programCode: packet.program?.code ?? null,
    client: { isMinor: packet.conditionSnapshot?.clientIsMinor ?? null }, snapshotId: packet.conditionSnapshot?.id ?? null,
    runtimeVersion: packet.conditionRuntimeVersion, definition, packetDocumentsByMappingId,
    packetDocumentsById, pdfFieldsById, documentFieldValues, integrityErrors: errors,
  }
}

function knownEmptyInputs(detail: GroupEvaluationDetail): string[] {
  const values: string[] = []
  for (const condition of detail.conditions) {
    if (condition.resolvedValue === null || condition.resolvedValue === undefined || condition.resolvedValue === "") {
      values.push(condition.sourcePacketTemplateDocumentId ? `${condition.sourcePacketTemplateDocumentId}:${condition.sourceFieldKey}` : condition.sourceFieldKey ?? condition.sourceType)
    }
  }
  for (const child of detail.childGroups) values.push(...knownEmptyInputs(child))
  return values
}

function evaluate(runtime: PacketConditionRuntime, group: EvaluationGroup | null, fieldValues: Record<string, unknown>, staticDefault: boolean): RuntimeEvaluation {
  if (runtime.integrityErrors.length > 0) return { status: "integrity_error", errors: runtime.integrityErrors }
  if (!group) return { status: "evaluated", result: staticDefault, knownEmptyInputs: [], detail: null }
  if (runtime.client.isMinor === null) return { status: "integrity_error", errors: [{ type: "missing_minor_context", message: "Snapshot minor context is unavailable" }] }
  const context: EvaluationContext = {
    fieldValues,
    documentFieldValues: runtime.documentFieldValues,
    client: { isMinor: runtime.client.isMinor },
    packet: { programCode: runtime.programCode, packetType: runtime.packetType },
  }
  const result = evaluateConditionTree(group, context)
  return { status: "evaluated", result: result.result, knownEmptyInputs: knownEmptyInputs(result.detail), detail: result.detail }
}

function mapping(runtime: PacketConditionRuntime, mappingId: string) {
  return runtime.definition?.mappings.find((entry) => entry.id === mappingId)
}

export function evaluatePacketDocumentInclusion(runtime: PacketConditionRuntime, mappingId: string): RuntimeEvaluation {
  if (runtime.mode === "legacy") return { status: "evaluated", result: true, knownEmptyInputs: [], detail: null }
  const owner = mapping(runtime, mappingId)
  if (!owner) return { status: "integrity_error", errors: [{ type: "missing_mapping", message: "Mapping is absent from snapshot", mappingId }] }
  return evaluate(runtime, owner.conditionGroups.find((group) => group.purpose === "DOCUMENT_INCLUSION") ?? null, {}, true)
}

/**
 * `id` means different things by mode: a PacketTemplateDocument mapping id
 * for snapshot packets (definition.mappings are keyed that way), or a
 * PacketDocument's own id for legacy packets (which carry no mapping id at
 * all — packetDocumentsByMappingId is always empty for them). No condition
 * logic applies to a legacy document; its effective requiredness is exactly
 * its persisted PacketDocument.isRequired, read from the direct index.
 */
export function evaluatePacketDocumentRequiredness(runtime: PacketConditionRuntime, id: string): RuntimeEvaluation {
  if (runtime.mode === "legacy") {
    const document = runtime.packetDocumentsById[id]
    if (!document) return { status: "integrity_error", errors: [{ type: "missing_packet_document", message: "Packet document is absent from runtime context", packetDocumentId: id }] }
    return { status: "evaluated", result: document.isRequired, knownEmptyInputs: [], detail: null }
  }
  const owner = mapping(runtime, id)
  if (!owner) return { status: "integrity_error", errors: [{ type: "missing_mapping", message: "Mapping is absent from snapshot", mappingId: id }] }
  return evaluate(runtime, owner.conditionGroups.find((group) => group.purpose === "DOCUMENT_REQUIREDNESS") ?? null, {}, owner.required)
}

function fieldOwner(runtime: PacketConditionRuntime, packetDocumentId: string, fieldId: string) {
  const document = Object.values(runtime.packetDocumentsByMappingId).find((entry) => entry.id === packetDocumentId)
  const field = document?.fieldsById[fieldId]
  const snapshotField = field?.templateFieldKey ? mapping(runtime, document!.mappingId)?.fields.find((entry) => entry.fieldKey === field.templateFieldKey) : null
  return { document, field, snapshotField }
}

export function evaluatePdfFieldVisibility(runtime: PacketConditionRuntime, packetDocumentId: string, fieldId: string): RuntimeEvaluation {
  if (runtime.mode === "legacy") return { status: "evaluated", result: true, knownEmptyInputs: [], detail: null }
  const { document, field, snapshotField } = fieldOwner(runtime, packetDocumentId, fieldId)
  if (!document || !field) return { status: "integrity_error", errors: [{ type: "missing_field", message: "PDF field is absent from runtime context", packetDocumentId, fieldId }] }
  if (!field.templateFieldKey) return { status: "evaluated", result: true, knownEmptyInputs: [], detail: null }
  if (!snapshotField) return { status: "integrity_error", errors: [{ type: "missing_field_key", message: "PDF field key is absent from snapshot", packetDocumentId, fieldId }] }
  return evaluate(runtime, snapshotField.conditionGroups.find((group) => group.purpose === "FIELD_VISIBILITY") ?? null, document.fieldValues, true)
}

// No condition logic applies to a legacy field: visibility is always true
// (see evaluatePdfFieldVisibility above) and effective requiredness is
// exactly its persisted PdfField.isRequired, read from the direct index.
export function evaluatePdfFieldRequiredness(runtime: PacketConditionRuntime, packetDocumentId: string, fieldId: string): RuntimeEvaluation {
  if (runtime.mode === "legacy") {
    const field = runtime.pdfFieldsById[fieldId]
    if (!field) return { status: "integrity_error", errors: [{ type: "missing_field", message: "PDF field is absent from runtime context", packetDocumentId, fieldId }] }
    return { status: "evaluated", result: field.isRequired, knownEmptyInputs: [], detail: null }
  }
  const visibility = evaluatePdfFieldVisibility(runtime, packetDocumentId, fieldId)
  if (visibility.status === "integrity_error" || !visibility.result) return visibility.status === "integrity_error" ? visibility : { ...visibility, result: false }
  const { document, field, snapshotField } = fieldOwner(runtime, packetDocumentId, fieldId)
  if (!document || !field || !snapshotField) return { status: "integrity_error", errors: [{ type: "missing_field", message: "PDF field source is unavailable", packetDocumentId, fieldId }] }
  return evaluate(runtime, snapshotField.conditionGroups.find((group) => group.purpose === "FIELD_REQUIREDNESS") ?? null, document.fieldValues, field.staticRequired)
}

export function evaluatePacketApplicability(runtime: PacketConditionRuntime) {
  if (runtime.mode === "legacy") return { mode: "legacy" as const, documents: {}, integrityErrors: [] }
  const documents = Object.fromEntries((runtime.definition?.mappings ?? []).map((entry) => [entry.id, {
    inclusion: evaluatePacketDocumentInclusion(runtime, entry.id),
    requiredness: evaluatePacketDocumentRequiredness(runtime, entry.id),
  }]))
  return { mode: "snapshot" as const, documents, integrityErrors: runtime.integrityErrors }
}
