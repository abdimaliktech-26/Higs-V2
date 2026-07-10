"use server"

import { revalidatePath } from "next/cache"
import { validate } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { UserRole, type Prisma } from "@prisma/client"
import { runExtraction, generatePacketRecommendations, type AiSuggestion } from "@/lib/ai-engine"
import { limiters, checkRateLimit } from "@/lib/rate-limit"

const USE_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

export async function runDocumentExtraction(documentId: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const rl = checkRateLimit(limiters.ai, user.id as string)
  if (rl) return rl

  const doc = await prisma.packetDocument.findUnique({
    where: { id: documentId },
    include: { packet: true, fields: true },
  })
  if (!doc) return { success: false as const, error: "Not found" }
  await requireOrgAccess(doc.packet.organizationId)
  if (!USE_ROLES.includes(getActiveRole(user as any)) && !(user.isSuperAdmin as boolean))
    return { success: false as const, error: "Insufficient permissions" }

  const startTime = Date.now()
  const { extractedFields, overallConfidence, suggestions } = runExtraction(
    doc.fields.map(f => ({ name: f.name, fieldType: f.fieldType, value: f.value, isRequired: f.isRequired }))
  )
  const processingTime = Date.now() - startTime

  const extraction = await prisma.aiExtraction.create({
    data: {
      organizationId: doc.packet.organizationId,
      packetDocumentId: documentId,
      fields: extractedFields as any as Prisma.InputJsonValue,
      overallConfidence,
      status: "completed",
      processingTime,
      ranById: user.id as string,
    },
  })

  // Create recommendations from suggestions
  for (const s of suggestions) {
    await prisma.aiRecommendation.create({
      data: {
        organizationId: doc.packet.organizationId,
        packetDocumentId: documentId,
        type: s.type,
        message: s.message,
        confidence: s.confidence,
        source: "ai",
        status: "open",
      },
    })
  }

  await createAuditEvent({
    organizationId: doc.packet.organizationId,
    actorId: user.id as string,
    action: "AI_EXTRACTION_RUN",
    targetType: "packet_document",
    targetId: documentId,
    metadata: { overallConfidence, fieldCount: extractedFields.length, suggestionsCount: suggestions.length },
  })

  revalidatePath(`/documents/${documentId}/edit`)
  return { success: true as const, data: { extractionId: extraction.id, overallConfidence, suggestionsCount: suggestions.length } }
}

export async function runPacketAnalysis(packetId: string): Promise<ActionResult> {
  try {
    const session = await auth()
    if (!session?.user) return { success: false, error: "Unauthorized" }
    const user = session.user as Record<string, unknown>
    const rl = checkRateLimit(limiters.ai, user.id as string)
    if (rl) return rl

    const packet = await prisma.packet.findUnique({
      where: { id: packetId },
      include: {
        documents: { include: { documentTemplate: true, fields: true } },
        validationResults: { orderBy: { ranAt: "desc" }, take: 1 },
        signatureRequests: true,
      },
    })
    if (!packet) return { success: false, error: "Not found" }
    await requireOrgAccess(packet.organizationId)
    if (!USE_ROLES.includes(getActiveRole(user as any)) && !(user.isSuperAdmin as boolean))
      return { success: false, error: "Insufficient permissions" }

    const suggestions = generatePacketRecommendations(
      { status: packet.status, dueDate: packet.dueDate },
      packet.documents.map(d => ({ status: d.status, isRequired: d.isRequired, name: d.documentTemplate.name })),
      packet.validationResults.map(v => ({ score: v.score, criticalCount: v.criticalCount })),
      packet.signatureRequests.map(s => ({ status: s.status })),
    )

    for (const s of suggestions) {
      await prisma.aiRecommendation.create({
        data: {
          organizationId: packet.organizationId,
          packetId,
          type: s.type,
          message: s.message,
          confidence: s.confidence,
          source: "ai",
          status: "open",
        },
      })
    }

    await createAuditEvent({
      organizationId: packet.organizationId,
      actorId: user.id as string,
      action: "AI_RECOMMENDATION_GENERATED",
      targetType: "packet",
      targetId: packetId,
      metadata: { suggestionsCount: suggestions.length },
    })

    revalidatePath(`/packets/${packetId}`)
    return { success: true, data: { suggestionsCount: suggestions.length } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function applyRecommendation(recommendationId: string, status: "applied" | "dismissed") {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const rec = await prisma.aiRecommendation.findUnique({ where: { id: recommendationId } })
  if (!rec) return { success: false as const, error: "Not found" }
  await requireOrgAccess(rec.organizationId)

  await prisma.aiRecommendation.update({
    where: { id: recommendationId },
    data: { status, appliedAt: status === "applied" ? new Date() : null, appliedById: status === "applied" ? user.id as string : null },
  })

  if (status === "applied") {
    await createAuditEvent({
      organizationId: rec.organizationId,
      actorId: user.id as string,
      action: "AI_RECOMMENDATION_APPLIED",
      targetType: "ai_recommendation",
      targetId: recommendationId,
      metadata: { type: rec.type, message: rec.message },
    })
  }

  revalidatePath("/ai-copilot")
  return { success: true as const, data: { id: recommendationId, status } }
}

export async function getAiExtractions(orgId: string, params?: { documentId?: string; page?: number }) {
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.documentId) where.packetDocumentId = params.documentId

  const [extractions, total] = await Promise.all([
    prisma.aiExtraction.findMany({
      where: where as any, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize,
      include: {
        packetDocument: { include: { documentTemplate: { select: { name: true } }, packet: { select: { client: { select: { firstName: true, lastName: true } } } } } },
        ranBy: { select: { name: true } },
      },
    }),
    prisma.aiExtraction.count({ where: where as any }),
  ])
  return { extractions, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getAiRecommendations(orgId: string, params?: { type?: string; status?: string; packetId?: string }) {
  await requireOrgAccess(orgId)
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.type) where.type = params.type
  if (params?.status) where.status = params.status
  if (params?.packetId) where.packetId = params.packetId

  return prisma.aiRecommendation.findMany({
    where: where as any,
    orderBy: { createdAt: "desc" },
    take: 50,
    include: {
      packet: { select: { client: { select: { firstName: true, lastName: true } } } },
      packetDocument: { include: { documentTemplate: { select: { name: true } } } },
    },
  })
}
