"use server"

import { revalidatePath } from "next/cache"
import { validate, createValidationRuleSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import {
  ORGANIZATION_WIDE_CLIENT_ROLES,
  getLiveStaffAuthorizationContext,
  requireActiveOrganizationMembership,
  requireOrganizationRole,
  requirePacketAccess,
} from "@/lib/live-authorization"
import { createAuditEvent } from "@/lib/audit"
import { UserRole } from "@prisma/client"
import { limiters, checkRateLimit } from "@/lib/rate-limit"
import { buildPacketConditionContext, buildEditorDocumentConditionState } from "@/lib/conditions/runtime"

const MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
const RUN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

// === Validation Rules ===

export async function getValidationRules(orgId: string, params?: { category?: string; active?: boolean }) {
  await requireActiveOrganizationMembership(orgId, "list validation rules")
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.category) where.category = params.category
  if (params?.active !== undefined) where.active = params.active
  return prisma.validationRule.findMany({ where: where as any, orderBy: { createdAt: "desc" } })
}

export async function createValidationRule(raw: Record<string, unknown>) {
  const parsed = validate(createValidationRuleSchema, raw)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const data = parsed.data
  const identity = await getLiveStaffAuthorizationContext()
  const orgId = identity.selectedOrganizationId
  if (!orgId) return { success: false as const, error: "Select an organization" }
  await requireOrganizationRole(orgId, MANAGE_ROLES, "create validation rule")

  await prisma.validationRule.create({ data: { organizationId: orgId, ...data } })
  revalidatePath("/compliance-rules-engine")
  return { success: true as const, data: { } }
}

// ── Staff: activate/deactivate a ValidationRule — deactivating one actually
// stops runPacketValidation from enforcing that category, not just a display flag ──
export async function updateValidationRuleActive(ruleId: string, active: boolean) {
  const rule = await prisma.validationRule.findUnique({ where: { id: ruleId } })
  if (!rule) return { success: false as const, error: "Rule not found" }
  const authorization = await requireOrganizationRole(rule.organizationId, MANAGE_ROLES, "change validation rule status")

  await prisma.validationRule.update({ where: { id: ruleId }, data: { active } })

  await createAuditEvent({
    organizationId: rule.organizationId,
    actorId: authorization.userId,
    action: "VALIDATION_RULE_STATUS_CHANGED",
    targetType: "validation_rule",
    targetId: ruleId,
    metadata: { active },
  })
  revalidatePath("/compliance-rules-engine")
  return { success: true as const, data: { id: ruleId, active } }
}

// === Run Validation ===

export async function runPacketValidation(packetId: string) {
  const authorization = await requirePacketAccess(packetId, "manage", "run packet validation")
  const actorId = authorization.userId
  const rl = checkRateLimit(limiters.validation, actorId)
  if (rl) return rl

  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    include: {
      client: true,
      documents: { include: { documentTemplate: true, fields: true } },
      packetTemplate: { include: { requiredDocs: true } },
      program: { select: { id: true, code: true, name: true } },
    },
  })
  if (!packet) return { success: false as const, error: "Packet not found" }
  type PacketDocForValidation = (typeof packet.documents)[number]
  type PacketFieldForValidation = PacketDocForValidation["fields"][number]
  if (authorization.organizationId !== packet.organizationId || !RUN_ROLES.includes(authorization.role))
    return { success: false as const, error: "Insufficient permissions" }

  const rules = await prisma.validationRule.findMany({
    where: { organizationId: packet.organizationId, active: true },
    orderBy: { createdAt: "asc" },
  })

  // A rule only applies if its own program/packetType scoping (when set)
  // matches this packet — an unscoped rule (both null) always applies.
  function ruleAppliesToPacket(rule: { program: string | null; packetType: string | null }): boolean {
    if (rule.packetType && rule.packetType !== packet!.packetType) return false
    if (rule.program) {
      if (!packet!.program) return false
      const matches = rule.program === packet!.program.id || rule.program === packet!.program.code || rule.program === packet!.program.name
      if (!matches) return false
    }
    return true
  }

  // First active, scope-matching rule for a category — deterministic by
  // createdAt ascending. A category with no matching active rule is skipped
  // entirely (an org that hasn't configured that rule gets no check for it,
  // rather than falling back to a hidden hardcoded default).
  function findActiveRule(category: string) {
    return rules.find((r) => r.category === category && ruleAppliesToPacket(r))
  }

  const requiredFieldRule = findActiveRule("required_field")
  const requiredSignatureRule = findActiveRule("required_signature")

  // ── Step 4c.4b: field-level condition-aware required_field/required_signature ──
  //
  // Only built when at least one of those two rule categories is actually
  // active for this packet — an org that doesn't use either rule pays no
  // extra query/evaluation cost. Built once per validation run and reused
  // across every document — never per-document, never per-field. Reuses
  // buildPacketConditionContext + buildEditorDocumentConditionState exactly
  // as the PDF editor already does (getEditableDocument/
  // evaluateDocumentFieldConditions); no second evaluator implementation
  // exists here.
  //
  // Packet validation is a compliance control, so a broken condition
  // configuration must never make a potentially required field silently
  // disappear from validation: a packet-level runtime build failure falls
  // back to static field.isRequired validation for the WHOLE packet, and a
  // document-level condition integrity error falls back to static
  // field.isRequired validation for just that ONE document — every other,
  // healthy document keeps full condition-aware validation. Failures are
  // logged (matching the existing console.error convention already used for
  // non-fatal internal failures elsewhere, e.g. src/lib/audit.ts) and never
  // surface as a new validation issue in this step.
  const docFieldConditionStates = new Map<string, { useStaticFallback: boolean; fieldsById: Record<string, { isVisible: boolean; effectiveRequired: boolean }> }>()
  if (requiredFieldRule || requiredSignatureRule) {
    let conditionRuntime: Awaited<ReturnType<typeof buildPacketConditionContext>> | null = null
    try {
      conditionRuntime = await buildPacketConditionContext(packetId)
    } catch (error) {
      console.error(`Packet validation: condition runtime unavailable for packet ${packetId}, falling back to static field validation for the whole packet`, error)
    }

    if (conditionRuntime) {
      const runtime = conditionRuntime
      // The evaluator treats runtime.integrityErrors as one flat, packet-wide
      // list — an error recorded against a single document/field would
      // otherwise cascade into "integrity_error" for every field of every
      // document in the packet. Scoping a per-document VIEW of that same
      // list (genuinely packet-wide errors, e.g. a malformed snapshot,
      // always included; errors tagged with this document's own id or
      // mapping id also included) restores true per-document isolation
      // without touching the shared evaluator or runtime module itself —
      // every other field of buildEditorDocumentConditionState's contract
      // is used completely unmodified.
      for (const doc of packet.documents) {
        const scopedErrors = runtime.integrityErrors.filter((error) =>
          (!error.packetDocumentId && !error.mappingId)
          || error.packetDocumentId === doc.id
          || (doc.packetTemplateDocumentId !== null && error.mappingId === doc.packetTemplateDocumentId)
        )
        const scopedRuntime = scopedErrors.length === runtime.integrityErrors.length ? runtime : { ...runtime, integrityErrors: scopedErrors }

        const state = buildEditorDocumentConditionState(
          scopedRuntime,
          { id: doc.id, applicabilityStatus: doc.applicabilityStatus, packetTemplateDocumentId: doc.packetTemplateDocumentId },
          doc.fields.map((f) => ({ id: f.id, templateFieldKey: f.templateFieldKey, isRequired: f.isRequired }))
        )
        if (state.hasConditionIntegrityError) {
          console.error(`Packet validation: condition integrity error for document ${doc.id}, falling back to static field validation for this document`)
        }
        docFieldConditionStates.set(doc.id, { useStaticFallback: state.hasConditionIntegrityError, fieldsById: state.fieldsById })
      }
    }
  }

  // Single shared predicate for both required_field and required_signature —
  // a field participates in required-field validation only when it is both
  // visible and effectively required. Supports both directions: a statically
  // required field that becomes effectively optional, and a statically
  // optional field that becomes effectively required. A conditionally
  // inactive document's fields never participate, regardless of condition
  // state health, matching Step 4c.4a's document-level exclusion. Falls back
  // to the pre-4c.4b static field.isRequired check whenever condition state
  // is unavailable (packet-level failure) or integrity-broken (document-level
  // failure) for that specific document.
  function fieldParticipatesInRequiredValidation(doc: PacketDocForValidation, field: PacketFieldForValidation): boolean {
    if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") return false
    const docState = docFieldConditionStates.get(doc.id)
    if (!docState || docState.useStaticFallback) return field.isRequired
    const fieldState = docState.fieldsById[field.id]
    if (!fieldState) return field.isRequired
    return fieldState.isVisible && fieldState.effectiveRequired
  }

  const issues: { severity: string; message: string; correction?: string; ruleId?: string; targetType?: string; targetId?: string; fieldName?: string }[] = []

  // Rule-driven: required fields — only enforced when an active, scope-matching "required_field" rule exists
  if (requiredFieldRule) {
    for (const doc of packet.documents) {
      const requiredFields = doc.fields.filter((f) => fieldParticipatesInRequiredValidation(doc, f))
      for (const field of requiredFields) {
        if (!field.value || field.value.trim() === "") {
          issues.push({
            severity: requiredFieldRule.severity, ruleId: requiredFieldRule.id,
            message: `Required field "${field.name}" is empty in ${doc.documentTemplate.name}`,
            correction: "Open the document and fill in the required field.",
            targetType: "document", targetId: doc.id, fieldName: field.name,
          })
        }
      }
    }
  }

  // Rule-driven: required signature fields — only enforced when an active, scope-matching "required_signature" rule exists
  if (requiredSignatureRule) {
    for (const doc of packet.documents) {
      const requiredSignatures = doc.fields.filter((f) => fieldParticipatesInRequiredValidation(doc, f) && f.fieldType === "signature")
      for (const field of requiredSignatures) {
        if (!field.value || field.value.trim() === "") {
          issues.push({
            severity: requiredSignatureRule.severity, ruleId: requiredSignatureRule.id,
            message: `Required signature "${field.name}" is missing in ${doc.documentTemplate.name}`,
            correction: "Route the document for signature before validation.",
            targetType: "document", targetId: doc.id, fieldName: field.name,
          })
        }
      }
    }
  }

  // Rule-driven: missing documents — only enforced when an active, scope-matching "missing_document" rule exists
  const missingDocumentRule = findActiveRule("missing_document")
  if (missingDocumentRule && packet.packetTemplate) {
    const required = packet.packetTemplate.requiredDocs
    for (const req of required) {
      const hasDoc = packet.documents.some(d => d.documentTemplateId === req.documentTemplateId)
      if (!hasDoc) {
        issues.push({
          severity: missingDocumentRule.severity, ruleId: missingDocumentRule.id,
          message: `Required document is missing from packet`,
          correction: "Add the missing document to the packet from the template.",
          targetType: "packet", targetId: packetId,
        })
      }
    }
  }

  // Always-on structural check (not rule-gated): incomplete packet documents.
  // A conditionally inactive document (applicabilityStatus set by the
  // packet condition system, persisted on PacketDocument — no runtime
  // evaluation performed here) is not currently applicable to this packet
  // and is silently excluded, matching the same predicate used in
  // packet-overview-metrics.ts.
  for (const doc of packet.documents) {
    if (doc.isRequired && doc.applicabilityStatus !== "CONDITIONALLY_INACTIVE" && doc.status !== "completed") {
      issues.push({
        severity: doc.status === "in_progress" ? "warning" : "critical",
        message: `Required document "${doc.documentTemplate.name}" is ${doc.status.replace(/_/g, " ")}`,
        correction: "Complete the document fields and save before validation.",
        targetType: "document", targetId: doc.id,
      })
    }
  }

  // Rule-driven: overdue due dates — only enforced when an active, scope-matching "overdue_due_date" rule exists
  const overdueDueDateRule = findActiveRule("overdue_due_date")
  if (overdueDueDateRule && packet.dueDate && new Date(packet.dueDate) < new Date() && packet.status !== "approved" && packet.status !== "archived") {
    issues.push({
      severity: overdueDueDateRule.severity, ruleId: overdueDueDateRule.id,
      message: `Packet due date ${packet.dueDate.toLocaleDateString()} has passed`,
      correction: "Update the due date or complete the packet workflow.",
      targetType: "packet", targetId: packetId,
    })
  }

  // Always-on structural check (not rule-gated): missing signature placeholders
  const pendingDocs = packet.documents.filter(d => d.status !== "completed")
  if (pendingDocs.length > 0 && packet.status === "awaiting_signature") {
    issues.push({
      severity: "info",
      message: `${pendingDocs.length} document(s) need completion before signatures can proceed`,
      correction: "Complete all pending documents before routing for signature.",
      targetType: "packet", targetId: packetId,
    })
  }

  // Compute score
  const criticalCount = issues.filter(i => i.severity === "critical").length
  const warningCount = issues.filter(i => i.severity === "warning").length
  const infoCount = issues.filter(i => i.severity === "info").length
  const totalIssues = issues.length
  const score = Math.max(0, Math.round(100 - (criticalCount * 25 + warningCount * 10 + infoCount * 2)))

  const result = await prisma.validationResult.create({
    data: {
      organizationId: packet.organizationId,
      packetId: packet.id,
      score,
      totalIssues,
      criticalCount,
      warningCount,
      infoCount,
      ranById: actorId,
    },
  })

  for (const issue of issues) {
    await prisma.validationIssue.create({
      data: {
        validationResultId: result.id,
        validationRuleId: issue.ruleId || null,
        severity: issue.severity,
        message: issue.message,
        correction: issue.correction || null,
        targetType: issue.targetType || null,
        targetId: issue.targetId || null,
        fieldName: issue.fieldName || null,
      },
    })
  }

  const newStatus = criticalCount > 0 ? "validation_failed" : "needs_validation"
  await prisma.packet.update({ where: { id: packetId }, data: { status: newStatus } })

  await createAuditEvent({
    organizationId: packet.organizationId,
    actorId,
    action: "VALIDATION_RUN",
    targetType: "packet", targetId: packetId,
    metadata: { score, totalIssues, criticalCount, warningCount, infoCount, newStatus },
  })

  revalidatePath(`/packets/${packetId}`)
  revalidatePath("/validation")
  return { success: true as const, data: { resultId: result.id, score, totalIssues, newStatus } }
}

export async function getValidationResults(orgId: string, params?: { packetId?: string; page?: number; pageSize?: number }) {
  const authorization = await requireOrganizationRole(orgId, RUN_ROLES, "list validation results")
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (!ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role)) {
    const now = new Date()
    where.packet = {
      client: {
        assignments: {
          some: {
            staffUserId: authorization.userId,
            AND: [
              { OR: [{ startDate: null }, { startDate: { lte: now } }] },
              { OR: [{ endDate: null }, { endDate: { gt: now } }] },
            ],
          },
        },
      },
    }
  }
  if (params?.packetId) where.packetId = params.packetId

  const [results, total] = await Promise.all([
    prisma.validationResult.findMany({
      where: where as any,
      orderBy: { ranAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: {
        ranBy: { select: { name: true } },
        packet: { select: { id: true, packetType: true, status: true, client: { select: { firstName: true, lastName: true } } } },
        _count: { select: { issues: true } },
      },
    }),
    prisma.validationResult.count({ where: where as any }),
  ])
  return { results, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getValidationResultDetail(resultId: string) {
  const target = await prisma.validationResult.findUnique({ where: { id: resultId }, select: { packetId: true, organizationId: true } })
  if (!target?.packetId) return null
  const authorization = await requirePacketAccess(target.packetId, "manage", "view validation result")
  if (authorization.organizationId !== target.organizationId || !RUN_ROLES.includes(authorization.role)) return null

  const result = await prisma.validationResult.findUnique({
    where: { id: resultId },
    include: {
      ranBy: { select: { name: true, email: true } },
      packet: {
        include: {
          client: { select: { firstName: true, lastName: true, mcadId: true } },
          documents: { select: { id: true, documentTemplate: { select: { name: true } } }, orderBy: { sortOrder: "asc" } },
        },
      },
      issues: {
        orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
        include: { validationRule: { select: { name: true, category: true } }, resolvedBy: { select: { name: true } } },
      },
    },
  })
  if (!result) return null
  return result
}

export async function resolveValidationIssue(issueId: string) {
  const target = await prisma.validationIssue.findUnique({
    where: { id: issueId },
    select: { validationResult: { select: { packetId: true, organizationId: true } } },
  })
  if (!target?.validationResult.packetId) return { success: false as const, error: "Not found" }
  const authorization = await requirePacketAccess(target.validationResult.packetId, "manage", "resolve validation issue")
  if (authorization.organizationId !== target.validationResult.organizationId || !RUN_ROLES.includes(authorization.role)) {
    return { success: false as const, error: "Access denied" }
  }

  const issue = await prisma.validationIssue.findUnique({
    where: { id: issueId },
    include: { validationResult: { include: { packet: true } } },
  })
  if (!issue) return { success: false as const, error: "Not found" }

  await prisma.validationIssue.update({
    where: { id: issueId },
    data: { status: "resolved", resolvedAt: new Date(), resolvedById: authorization.userId },
  })

  // Recompute result score
  const result = issue.validationResult
  const issues = await prisma.validationIssue.findMany({ where: { validationResultId: result.id } })
  const openCritical = issues.filter(i => i.severity === "critical" && i.status === "open").length
  const openWarning = issues.filter(i => i.severity === "warning" && i.status === "open").length
  const openInfo = issues.filter(i => i.severity === "info" && i.status === "open").length
  const newScore = Math.max(0, Math.round(100 - (openCritical * 25 + openWarning * 10 + openInfo * 2)))

  await prisma.validationResult.update({
    where: { id: result.id },
    data: { score: newScore, totalIssues: issues.filter(i => i.status === "open").length, criticalCount: openCritical, warningCount: openWarning, infoCount: openInfo },
  })

  await createAuditEvent({
    organizationId: result.organizationId,
    actorId: authorization.userId,
    action: "VALIDATION_ISSUE_RESOLVED",
    targetType: "validation_issue", targetId: issueId,
    metadata: { validationResultId: result.id, packetId: result.packetId },
  })

  revalidatePath(`/validation/${result.id}`)
  return { success: true as const, data: { id: issueId, newScore } }
}
