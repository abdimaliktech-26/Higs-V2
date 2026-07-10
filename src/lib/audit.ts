import { prisma } from "./db"
import type { AuditAction, Prisma } from "@prisma/client"

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
