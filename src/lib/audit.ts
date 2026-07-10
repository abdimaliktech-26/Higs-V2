import { prisma } from "./db"
import type { AuditAction, PortalAuditAction, Prisma } from "@prisma/client"

export interface AuditEventInput {
  organizationId?: string | null
  actorId?: string | null
  action: AuditAction
  targetType?: string | null
  targetId?: string | null
  metadata?: Prisma.InputJsonValue
  ipAddress?: string | null
  userAgent?: string | null
}

export async function createAuditEvent(input: AuditEventInput) {
  try {
    await prisma.auditEvent.create({
      data: {
        organizationId: input.organizationId ?? null,
        actorId: input.actorId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  } catch (error) {
    console.error("Failed to create audit event:", error)
  }
}

export interface PortalAuditEventInput {
  organizationId?: string | null
  portalUserId?: string | null
  clientId?: string | null
  action: PortalAuditAction
  targetType?: string | null
  targetId?: string | null
  metadata?: Prisma.InputJsonValue
  ipAddress?: string | null
  userAgent?: string | null
}

/**
 * Separate from createAuditEvent — portal actors are PortalUser rows, not
 * staff User rows, and belong in their own table (PortalAuditEvent) rather
 * than overloading AuditEvent.actorId's staff-only FK.
 *
 * Accepts an optional transaction client so callers running inside
 * prisma.$transaction (e.g. portal invitation acceptance) can pass `tx` and
 * have the audit write commit/roll back atomically with the rest of the
 * transaction, instead of landing on a separate connection.
 */
export async function createPortalAuditEvent(input: PortalAuditEventInput, client: Pick<typeof prisma, "portalAuditEvent"> = prisma) {
  try {
    await client.portalAuditEvent.create({
      data: {
        organizationId: input.organizationId ?? null,
        portalUserId: input.portalUserId ?? null,
        clientId: input.clientId ?? null,
        action: input.action,
        targetType: input.targetType ?? null,
        targetId: input.targetId ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        ipAddress: input.ipAddress ?? null,
        userAgent: input.userAgent ?? null,
      },
    })
  } catch (error) {
    console.error("Failed to create portal audit event:", error)
  }
}
