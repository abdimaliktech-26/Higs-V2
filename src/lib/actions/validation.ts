"use server"

import { revalidatePath } from "next/cache"
import { validate, createValidationRuleSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole } from "@prisma/client"
import { limiters, checkRateLimit } from "@/lib/rate-limit"

const MANAGE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]
const RUN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

// === Validation Rules ===

export async function getValidationRules(orgId: string, params?: { category?: string; active?: boolean }) {
  await requireOrgAccess(orgId)
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.category) where.category = params.category
  if (params?.active !== undefined) where.active = params.active
  return prisma.validationRule.findMany({ where: where as any, orderBy: { createdAt: "desc" } })
}

export async function createValidationRule(raw: Record<string, unknown>) {
  const parsed = validate(createValidationRuleSchema, raw)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const data = parsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string
  await requireOrgAccess(orgId)
  if (!MANAGE_ROLES.includes(getActiveRole(user as any)) && !(user.isSuperAdmin as boolean))
    return { success: false as const, error: "Insufficient permissions" }

  await prisma.validationRule.create({ data: { organizationId: orgId, ...data } })
  revalidatePath("/validation")
  return { success: true as const, data: { } }
}

// === Run Validation ===

export async function runPacketValidation(packetId: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const actorId = user.id as string
  const rl = checkRateLimit(limiters.validation, actorId)
  if (rl) return rl

  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    include: {
      client: true,
      documents: { include: { documentTemplate: true, fields: true } },
      packetTemplate: { include: { requiredDocs: true } },
    },
  })
  if (!packet) return { success: false as const, error: "Packet not found" }
  await requireOrgAccess(packet.organizationId)
  const role = getActiveRole(user as any)
  if (!RUN_ROLES.includes(role) && !(user.isSuperAdmin as boolean))
    return { success: false as const, error: "Insufficient permissions" }

  const rules = await prisma.validationRule.findMany({
    where: { organizationId: packet.organizationId, active: true },
  })

  const issues: { severity: string; message: string; correction?: string; ruleId?: string; targetType?: string; targetId?: string; fieldName?: string }[] = []

  // Rule 1: Required fields check
  for (const doc of packet.documents) {
    const requiredFields = doc.fields.filter((f) => f.isRequired)
    for (const field of requiredFields) {
      if (!field.value || field.value.trim() === "") {
        issues.push({
          severity: "critical", ruleId: rules.find(r => r.category === "required_field")?.id,
          message: `Required field "${field.name}" is empty in ${doc.documentTemplate.name}`,
          correction: "Open the document and fill in the required field.",
          targetType: "document", targetId: doc.id, fieldName: field.name,
        })
      }
    }
  }

  // Rule 2: Missing documents
  if (packet.packetTemplate) {
    const required = packet.packetTemplate.requiredDocs
    for (const req of required) {
      const hasDoc = packet.documents.some(d => d.documentTemplateId === req.documentTemplateId)
      if (!hasDoc) {
        issues.push({
          severity: "critical",
          message: `Required document is missing from packet`,
          correction: "Add the missing document to the packet from the template.",
          targetType: "packet", targetId: packetId,
        })
      }
    }
  }

  // Rule 3: Incomplete packet documents
  for (const doc of packet.documents) {
    if (doc.isRequired && doc.status !== "completed") {
      issues.push({
        severity: doc.status === "in_progress" ? "warning" : "critical",
        message: `Required document "${doc.documentTemplate.name}" is ${doc.status.replace(/_/g, " ")}`,
        correction: "Complete the document fields and save before validation.",
        targetType: "document", targetId: doc.id,
      })
    }
  }

  // Rule 4: Overdue due dates
  if (packet.dueDate && new Date(packet.dueDate) < new Date() && packet.status !== "approved" && packet.status !== "archived") {
    issues.push({
      severity: "warning",
      message: `Packet due date ${packet.dueDate.toLocaleDateString()} has passed`,
      correction: "Update the due date or complete the packet workflow.",
      targetType: "packet", targetId: packetId,
    })
  }

  // Rule 5: Missing signature placeholders
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
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
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
  await requireOrgAccess(result.organizationId)
  return result
}

export async function resolveValidationIssue(issueId: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const issue = await prisma.validationIssue.findUnique({
    where: { id: issueId },
    include: { validationResult: { include: { packet: true } } },
  })
  if (!issue) return { success: false as const, error: "Not found" }
  await requireOrgAccess(issue.validationResult.organizationId)

  await prisma.validationIssue.update({
    where: { id: issueId },
    data: { status: "resolved", resolvedAt: new Date(), resolvedById: user.id as string },
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
    actorId: user.id as string,
    action: "VALIDATION_ISSUE_RESOLVED",
    targetType: "validation_issue", targetId: issueId,
    metadata: { validationResultId: result.id, packetId: result.packetId },
  })

  revalidatePath(`/validation/${result.id}`)
  return { success: true as const, data: { id: issueId, newScore } }
}
