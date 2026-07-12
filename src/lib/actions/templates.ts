"use server"

import { revalidatePath } from "next/cache"
import { validate, createPacketTemplateSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { requireOrgAccess, getActiveRole } from "@/lib/permissions"
import { createAuditEvent } from "@/lib/audit"
import { auth } from "@/lib/auth"
import { signUrl } from "@/lib/storage"
import { validateTemplateConditions, validatePacketTemplateConditions } from "@/lib/actions/template-conditions"
import { buildPacketConditionDefinition, evaluateInitialPacketApplicability, deriveIsMinor } from "@/lib/conditions/runtime"
import { CONDITION_RUNTIME_VERSION } from "@/lib/conditions/runtime-types"
import { AuditAction, UserRole, type Prisma } from "@prisma/client"

const ADMIN_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"]

function canManage(user: Record<string, unknown>) {
  const role = getActiveRole(user as any)
  return user.isSuperAdmin as boolean || ADMIN_ROLES.includes(role)
}

// === Document Templates ===

export async function getDocumentTemplates(orgId: string, params?: { search?: string; status?: string; formType?: string; program?: string }) {
  await requireOrgAccess(orgId)
  const where: Prisma.DocumentTemplateWhereInput = { organizationId: orgId }
  if (params?.search) where.name = { contains: params.search, mode: "insensitive" }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.formType && params.formType !== "all") where.formType = params.formType
  if (params?.program && params.program !== "all") where.program = params.program
  return prisma.documentTemplate.findMany({
    where,
    include: {
      uploadedBy: { select: { name: true, email: true } },
      _count: { select: { packetTemplateDocs: true, packetDocuments: true } },
      fields: { select: { isRequired: true, fieldType: true } },
      previousVersion: { select: { id: true, version: true, status: true, _count: { select: { fields: true } } } },
      nextVersions: { select: { id: true, version: true, status: true, _count: { select: { fields: true } } } },
    },
    orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
  })
}

export async function getDocumentTemplateById(id: string) {
  const tpl = await prisma.documentTemplate.findUnique({
    where: { id },
    include: { uploadedBy: { select: { name: true, email: true } } },
  })
  if (!tpl) return null
  await requireOrgAccess(tpl.organizationId)
  // signUrl lives in a server-only module (fs/promises) — computed here so
  // client components (the Template Field Editor) never import it directly.
  return { ...tpl, signedFileUrl: signUrl(tpl.fileKey) }
}

// Document upload (initial creation and new-version uploads) happens via
// POST /api/templates and POST /api/templates/[templateId]/versions — real
// Route Handlers, not Server Actions, so the file is genuinely validated and
// stored (never a client-supplied fileUrl/fileKey) before any DocumentTemplate
// row is created. See src/app/api/templates/route.ts.

/**
 * Walks the version chain in both directions (previousVersionId backward,
 * nextVersions forward) to find every DocumentTemplate row in the same
 * version family as the given id — needed because the self-relation only
 * stores one hop per row, not a shared family key.
 */
async function getVersionFamilyIds(templateId: string): Promise<string[]> {
  const visited = new Set<string>([templateId])
  const queue = [templateId]

  while (queue.length > 0) {
    const currentId = queue.shift() as string
    const row = await prisma.documentTemplate.findUnique({
      where: { id: currentId },
      select: { previousVersionId: true },
    })
    const children = await prisma.documentTemplate.findMany({
      where: { previousVersionId: currentId },
      select: { id: true },
    })
    const neighborIds = [row?.previousVersionId, ...children.map((c) => c.id)].filter(
      (neighborId): neighborId is string => Boolean(neighborId)
    )
    for (const neighborId of neighborIds) {
      if (!visited.has(neighborId)) {
        visited.add(neighborId)
        queue.push(neighborId)
      }
    }
  }

  return Array.from(visited)
}

// ── Staff: activate/retire a DocumentTemplate — only one ACTIVE row per
// version family. Activating a version transactionally retires every other
// currently-active row in that same family; unrelated template families are
// never touched. ──
export async function updateTemplateStatus(id: string, status: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }

  const tpl = await prisma.documentTemplate.findUnique({ where: { id } })
  if (!tpl) return { success: false as const, error: "Not found" }
  await requireOrgAccess(tpl.organizationId)

  if (status === "active") {
    const conditionCheck = await validateTemplateConditions(id)
    if (!conditionCheck.valid) {
      const typeCounts = conditionCheck.errors.reduce<Record<string, number>>((acc, e) => {
        acc[e.type] = (acc[e.type] ?? 0) + 1
        return acc
      }, {})
      const summary = Object.entries(typeCounts).map(([type, count]) => `${count} ${type}`).join(", ")
      return { success: false as const, error: `Cannot activate: ${conditionCheck.errors.length} broken condition(s) (${summary})` }
    }

    const familyIds = await getVersionFamilyIds(id)
    const siblingIds = familyIds.filter((familyId) => familyId !== id)

    const retiredSiblings = await prisma.$transaction(async (tx) => {
      const activeSiblings = siblingIds.length
        ? await tx.documentTemplate.findMany({ where: { id: { in: siblingIds }, status: "active" }, select: { id: true } })
        : []
      if (activeSiblings.length > 0) {
        await tx.documentTemplate.updateMany({
          where: { id: { in: activeSiblings.map((s) => s.id) } },
          data: { status: "retired" },
        })
      }
      await tx.documentTemplate.update({ where: { id }, data: { status: "active" } })
      return activeSiblings.map((s) => s.id)
    })

    await createAuditEvent({
      organizationId: tpl.organizationId, actorId: user.id as string, action: "TEMPLATE_ACTIVATED",
      targetType: "document_template", targetId: id, metadata: { name: tpl.name, retiredSiblingIds: retiredSiblings },
    })
    for (const siblingId of retiredSiblings) {
      await createAuditEvent({
        organizationId: tpl.organizationId, actorId: user.id as string, action: "TEMPLATE_RETIRED",
        targetType: "document_template", targetId: siblingId, metadata: { name: tpl.name, supersededById: id },
      })
    }
  } else {
    await prisma.documentTemplate.update({ where: { id }, data: { status } })
    if (status === "retired") {
      await createAuditEvent({ organizationId: tpl.organizationId, actorId: user.id as string, action: "TEMPLATE_RETIRED", targetType: "document_template", targetId: id, metadata: { name: tpl.name } })
    }
  }

  revalidatePath("/templates")
  return { success: true as const, data: { id } }
}

// === Packet Templates ===

export async function getPacketTemplates(orgId: string, params?: { includeInactive?: boolean; status?: string; programId?: string; packetType?: string }) {
  await requireOrgAccess(orgId)
  const where: Prisma.PacketTemplateWhereInput = { organizationId: orgId }
  if (params?.includeInactive) {
    if (params.status && params.status !== "all") where.status = params.status
  } else {
    where.status = params?.status && params.status !== "all" ? params.status : "active"
  }
  if (params?.programId && params.programId !== "all") where.programId = params.programId
  if (params?.packetType && params.packetType !== "all") where.packetType = params.packetType

  return prisma.packetTemplate.findMany({
    where,
    include: { program: { select: { id: true, name: true, code: true } }, requiredDocs: { include: { documentTemplate: true }, orderBy: { sortOrder: "asc" } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  })
}

const TEMPLATE_AUDIT_ACTIONS: AuditAction[] = [
  "TEMPLATE_UPLOADED",
  "TEMPLATE_ACTIVATED",
  "TEMPLATE_RETIRED",
  "PACKET_TEMPLATE_CREATED",
]

export async function getTemplateActivity(orgId: string, limit = 8) {
  await requireOrgAccess(orgId)
  return prisma.auditEvent.findMany({
    where: {
      organizationId: orgId,
      OR: [
        { action: { in: TEMPLATE_AUDIT_ACTIONS } },
        { targetType: { in: ["document_template", "packet_template"] } },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { actor: { select: { name: true, email: true } } },
  })
}

export async function createPacketTemplate(raw: Record<string, unknown>) {
  const parsed = validate(createPacketTemplateSchema, raw)
  if (!parsed.success) return { success: false as const, error: parsed.error }
  const data = parsed.data
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  const orgId = user.activeOrganizationId as string
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }
  await requireOrgAccess(orgId)

  if (data.documents.length > 0) {
    const owned = await prisma.documentTemplate.count({
      where: { id: { in: data.documents.map((d) => d.documentTemplateId) }, organizationId: orgId },
    })
    if (owned !== data.documents.length) {
      return { success: false as const, error: "One or more documents were not found" }
    }
  }

  const pt = await prisma.packetTemplate.create({
    data: { organizationId: orgId, name: data.name, description: data.description, packetType: data.packetType, programId: data.programId || null, isDefault: false, status: "active" },
  })

  for (let i = 0; i < data.documents.length; i++) {
    await prisma.packetTemplateDocument.create({
      data: { packetTemplateId: pt.id, documentTemplateId: data.documents[i].documentTemplateId, required: data.documents[i].required, sortOrder: i },
    })
  }

  await createAuditEvent({ organizationId: orgId, actorId: user.id as string, action: "PACKET_TEMPLATE_CREATED", targetType: "packet_template", targetId: pt.id, metadata: { name: pt.name } })
  revalidatePath("/templates")
  return { success: true as const, data: { id: pt.id } }
}

// ── Staff: toggle an existing packet template document mapping between required/optional ──
export async function updatePacketTemplateDocumentRequired(packetTemplateDocumentId: string, required: boolean) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }

  const row = await prisma.packetTemplateDocument.findUnique({
    where: { id: packetTemplateDocumentId },
    include: { packetTemplate: { select: { id: true, organizationId: true } } },
  })
  if (!row) return { success: false as const, error: "Mapping not found" }
  await requireOrgAccess(row.packetTemplate.organizationId)

  await prisma.packetTemplateDocument.update({ where: { id: packetTemplateDocumentId }, data: { required } })

  await createAuditEvent({
    organizationId: row.packetTemplate.organizationId,
    actorId: user.id as string,
    action: "PACKET_TEMPLATE_DOCUMENT_UPDATED",
    targetType: "packet_template",
    targetId: row.packetTemplate.id,
    metadata: { packetTemplateDocumentId, required },
  })
  revalidatePath("/templates")
  return { success: true as const, data: { id: packetTemplateDocumentId, required } }
}

// === Packet Instances ===

export async function getPackets(orgId: string, params?: { search?: string; status?: string; page?: number; pageSize?: number }) {
  await requireOrgAccess(orgId)
  const page = params?.page ?? 1; const pageSize = params?.pageSize ?? 20
  const where: Record<string, unknown> = { organizationId: orgId }
  if (params?.status && params.status !== "all") where.status = params.status
  if (params?.search) where.OR = [
    { client: { firstName: { contains: params.search, mode: "insensitive" } } },
    { client: { lastName: { contains: params.search, mode: "insensitive" } } },
    { packetType: { contains: params.search, mode: "insensitive" } },
  ]

  const [packets, total] = await Promise.all([
    prisma.packet.findMany({
      where: where as any,
      orderBy: { updatedAt: "desc" },
      skip: (page - 1) * pageSize, take: pageSize,
      include: { client: { select: { id: true, firstName: true, lastName: true } }, assignedTo: { select: { name: true } }, _count: { select: { documents: true } } },
    }),
    prisma.packet.count({ where: where as any }),
  ])
  return { packets, total, page, pageSize, totalPages: Math.ceil(total / pageSize) }
}

export async function getPacketById(packetId: string) {
  const packet = await prisma.packet.findUnique({
    where: { id: packetId },
    include: {
      client: { include: { enrollments: { include: { program: true } }, assignments: { include: { staff: { select: { name: true } } } }, organization: { select: { name: true } }, diagnoses: { where: { isActive: true }, select: { code: true, description: true, type: true } } } },
      packetTemplate: { select: { name: true, id: true } },
      program: { select: { name: true } },
      assignedTo: { select: { id: true, name: true, email: true } },
      documents: {
        include: {
          documentTemplate: true,
          validationResults: { select: { criticalCount: true, warningCount: true }, orderBy: { ranAt: "desc" }, take: 1 },
        },
        orderBy: { sortOrder: "asc" },
      },
    },
  })
  if (!packet) return null
  await requireOrgAccess(packet.organizationId)

  await createAuditEvent({ organizationId: packet.organizationId, actorId: undefined, action: "PACKET_VIEWED", targetType: "packet", targetId: packetId, metadata: { clientName: `${packet.client.firstName} ${packet.client.lastName}` } })
  return packet
}

// ── Staff: create a Packet from a PacketTemplate — Step 4c.2a ──
// Fully transactional: packet + condition snapshot + PacketDocuments +
// PdfFields + audit all commit together or not at all. Every id in `data`
// (client, packet template) and everything reachable from the selected
// template (mapped documents, their organization, the template's program)
// is independently re-verified against the caller's active organization —
// none of it is trusted from the request. Document inclusion is evaluated
// against the template's real condition trees but is NOT treated as
// permanently static: a condition that depends on a TEMPLATE_FIELD value
// with nothing filled in yet is classified "unresolved" and defaults to the
// conservative, compliance-safe choice (include the document, keep its
// static requiredness) rather than guessing — see
// evaluateInitialPacketApplicability in src/lib/conditions/runtime.ts for
// the classification policy. Real re-evaluation once fields are actually
// filled in is Step 4c.2b; this step only computes and reports which
// mappings are still pending that reconciliation.
export async function createPacket(data: {
  clientId: string; packetTemplateId: string; dueDate?: string; assignedToId?: string
}) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>
  if (!canManage(user)) return { success: false as const, error: "Insufficient permissions" }
  const orgId = user.activeOrganizationId as string
  if (!orgId) return { success: false as const, error: "No org" }
  await requireOrgAccess(orgId)

  const client = await prisma.client.findUnique({ where: { id: data.clientId }, select: { id: true, organizationId: true, dateOfBirth: true } })
  if (!client || client.organizationId !== orgId) return { success: false as const, error: "Client not found" }

  const pt = await prisma.packetTemplate.findUnique({
    where: { id: data.packetTemplateId },
    include: {
      program: { select: { id: true, code: true, organizationId: true } },
      requiredDocs: { include: { documentTemplate: { select: { id: true, organizationId: true } } }, orderBy: { sortOrder: "asc" } },
    },
  })
  if (!pt || pt.organizationId !== orgId) return { success: false as const, error: "Packet template not found" }
  if (pt.program && pt.program.organizationId !== orgId) return { success: false as const, error: "Packet template program mismatch" }
  for (const doc of pt.requiredDocs) {
    if (doc.documentTemplate.organizationId !== orgId) return { success: false as const, error: "Mapped document template belongs to a different organization" }
  }

  // Condition definitions must be structurally valid before anything is
  // created — never silently treated as false, never used to create a
  // partial packet.
  const packetTemplateCheck = await validatePacketTemplateConditions(pt.id)
  const documentTemplateIds = Array.from(new Set(pt.requiredDocs.map((d) => d.documentTemplateId)))
  const documentTemplateChecks = await Promise.all(documentTemplateIds.map((id) => validateTemplateConditions(id)))
  const totalConditionErrors = packetTemplateCheck.errors.length + documentTemplateChecks.reduce((sum, c) => sum + c.errors.length, 0)
  if (totalConditionErrors > 0) {
    return { success: false as const, error: `Cannot create packet: ${totalConditionErrors} broken condition definition(s) in the packet template or its mapped documents` }
  }

  const definition = await buildPacketConditionDefinition(orgId, pt.id)

  // Stable, trusted creation-time context — never derived from client-
  // supplied data or display text where a stable identifier exists.
  const referenceAt = new Date()
  const clientIsMinor = deriveIsMinor(client.dateOfBirth, referenceAt)
  const programCode = pt.program?.code ?? null
  const applicability = evaluateInitialPacketApplicability(definition, { client: { isMinor: clientIsMinor }, packet: { programCode, packetType: pt.packetType } })
  const included = applicability.filter((entry) => entry.include)

  const packet = await prisma.$transaction(async (tx) => {
    const snapshot = await tx.packetConditionSnapshot.create({
      data: {
        organizationId: orgId,
        packetTemplateId: pt.id,
        runtimeVersion: CONDITION_RUNTIME_VERSION,
        evaluationReferenceAt: referenceAt,
        clientIsMinor,
        definition: definition as unknown as Prisma.InputJsonValue,
      },
    })

    const createdPacket = await tx.packet.create({
      data: {
        organizationId: orgId, clientId: data.clientId, packetTemplateId: pt.id, programId: pt.programId ?? null,
        packetType: pt.packetType, status: "draft", dueDate: data.dueDate ? new Date(data.dueDate) : null,
        assignedToId: data.assignedToId || null,
        createdAt: referenceAt,
        conditionSnapshotId: snapshot.id,
        conditionRuntimeVersion: CONDITION_RUNTIME_VERSION,
        metadata: { createdBy: user.id } as Prisma.InputJsonValue,
      },
    })

    for (const entry of included) {
      const packetDocument = await tx.packetDocument.create({
        data: {
          packetId: createdPacket.id,
          documentTemplateId: entry.documentTemplateId,
          packetTemplateDocumentId: entry.mappingId,
          isRequired: entry.isRequired,
          sortOrder: entry.sortOrder,
          status: "pending",
          applicabilityStatus: entry.applicabilityStatus,
        },
      })

      const templateFields = await tx.documentTemplateField.findMany({
        where: { documentTemplateId: entry.documentTemplateId },
        orderBy: { sortOrder: "asc" },
      })
      if (templateFields.length > 0) {
        await tx.pdfField.createMany({
          data: templateFields.map((f) => ({
            packetDocumentId: packetDocument.id,
            templateFieldKey: f.fieldKey,
            documentTemplateFieldId: f.id,
            name: f.name,
            fieldType: f.fieldType,
            value: null,
            pageNumber: f.pageNumber,
            posX: f.posX,
            posY: f.posY,
            width: f.width,
            height: f.height,
            isRequired: f.isRequired,
            sortOrder: f.sortOrder,
            source: "template",
          })),
        })
      }

      await createAuditEvent({
        organizationId: orgId,
        actorId: user.id as string,
        action: "PACKET_DOCUMENT_INITIAL_APPLICABILITY_SET",
        targetType: "packet_document",
        targetId: packetDocument.id,
        metadata: {
          packetId: createdPacket.id, packetTemplateId: pt.id, packetTemplateDocumentId: entry.mappingId,
          packetDocumentId: packetDocument.id, applicabilityStatus: entry.applicabilityStatus,
          inclusionResolution: entry.inclusionResolution, requirednessResolution: entry.requirednessResolution,
          trigger: "packet_creation",
        },
      }, tx)
    }

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string, action: "PACKET_CONDITION_SNAPSHOT_CREATED",
      targetType: "packet_condition_snapshot", targetId: snapshot.id,
      metadata: { packetId: createdPacket.id, packetTemplateId: pt.id, snapshotId: snapshot.id, runtimeVersion: CONDITION_RUNTIME_VERSION, trigger: "packet_creation" },
    }, tx)

    await createAuditEvent({
      organizationId: orgId, actorId: user.id as string, action: "PACKET_CREATED", targetType: "packet", targetId: createdPacket.id,
      metadata: { clientId: data.clientId, packetTemplateId: pt.id },
    }, tx)

    return createdPacket
  })

  const pendingReconciliation = included
    .filter((entry) => entry.inclusionResolution === "unresolved" || entry.requirednessResolution === "unresolved")
    .map((entry): string => entry.mappingId)

  revalidatePath("/packets")
  revalidatePath(`/clients/${data.clientId}`)
  return { success: true as const, data: { id: packet.id, pendingReconciliation } }
}

export async function updatePacketStatus(packetId: string, status: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const packet = await prisma.packet.findUnique({ where: { id: packetId } })
  if (!packet) return { success: false as const, error: "Not found" }
  await requireOrgAccess(packet.organizationId)

  const updateData: Record<string, unknown> = { status }
  if (status === "approved" || status === "archived") updateData.completedAt = new Date()

  await prisma.packet.update({ where: { id: packetId }, data: updateData as any })

  await createAuditEvent({ organizationId: packet.organizationId, actorId: user.id as string, action: "PACKET_STATUS_CHANGED", targetType: "packet", targetId: packetId, metadata: { from: packet.status, to: status } })
  revalidatePath(`/packets/${packetId}`)
  revalidatePath("/packets")
  return { success: true as const, data: { id: packetId } }
}

export async function updatePacketDocumentStatus(packetDocumentId: string, status: string) {
  const session = await auth()
  if (!session?.user) return { success: false as const, error: "Unauthorized" }
  const user = session.user as Record<string, unknown>

  const doc = await prisma.packetDocument.findUnique({ where: { id: packetDocumentId }, include: { packet: true } })
  if (!doc) return { success: false as const, error: "Not found" }
  await requireOrgAccess(doc.packet.organizationId)

  await prisma.packetDocument.update({
    where: { id: packetDocumentId },
    data: { status, completedAt: status === "completed" ? new Date() : status === "pending" ? null : undefined },
  })

  await createAuditEvent({ organizationId: doc.packet.organizationId, actorId: user.id as string, action: "PACKET_DOCUMENT_STATUS_CHANGED", targetType: "packet_document", targetId: packetDocumentId, metadata: { packetId: doc.packetId, status } })
  revalidatePath(`/packets/${doc.packetId}`)
  return { success: true as const, data: { id: packetDocumentId } }
}

export async function getProgramsForOrg(orgId: string) {
  await requireOrgAccess(orgId)
  return prisma.program.findMany({ where: { organizationId: orgId, isActive: true }, orderBy: { name: "asc" } })
}
