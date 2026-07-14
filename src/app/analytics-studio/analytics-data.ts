import { prisma } from "@/lib/db"
import { CLIENT_READ_ROLES, ORGANIZATION_WIDE_CLIENT_ROLES, requireOrganizationRole } from "@/lib/live-authorization"

export interface ClientsByProgramRow {
  programId: string
  programName: string
  clientCount: number
}

/**
 * Real, tenant-scoped read: counts active client enrollments per program
 * via the existing ClientProgram junction table. No new Prisma model,
 * no mutation — mirrors the same narrow read-only pattern already used
 * in org-settings-data.ts / super-admin-data.ts / work-queue-data.ts.
 */
export async function getClientsByProgram(orgId: string): Promise<ClientsByProgramRow[]> {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "view clients-by-program analytics")
  const now = new Date()
  const assignmentScope = ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role) ? {} : {
    client: { assignments: { some: {
      staffUserId: authorization.userId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    } } },
  }

  const programs = await prisma.program.findMany({
    where: { organizationId: orgId, isActive: true },
    select: {
      id: true,
      name: true,
      _count: { select: { enrollments: { where: { status: "active", ...assignmentScope } } } },
    },
    orderBy: { name: "asc" },
  })

  return programs.map((p) => ({ programId: p.id, programName: p.name, clientCount: p._count.enrollments }))
}

export interface MonthlyClientGrowthPoint {
  month: string
  count: number
}

/**
 * Real, tenant-scoped read: buckets existing Client.createdAt values by
 * month over the last N months. No new Prisma model, no mutation.
 */
export async function getMonthlyClientGrowth(orgId: string, months = 6): Promise<MonthlyClientGrowthPoint[]> {
  const authorization = await requireOrganizationRole(orgId, CLIENT_READ_ROLES, "view monthly client-growth analytics")
  const now = new Date()
  const assignmentScope = ORGANIZATION_WIDE_CLIENT_ROLES.includes(authorization.role) ? {} : {
    assignments: { some: {
      staffUserId: authorization.userId,
      AND: [
        { OR: [{ startDate: null }, { startDate: { lte: now } }] },
        { OR: [{ endDate: null }, { endDate: { gt: now } }] },
      ],
    } },
  }

  const since = new Date()
  since.setMonth(since.getMonth() - (months - 1))
  since.setDate(1)
  since.setHours(0, 0, 0, 0)

  const clients = await prisma.client.findMany({
    where: { organizationId: orgId, createdAt: { gte: since }, ...assignmentScope },
    select: { createdAt: true },
  })

  const buckets = new Map<string, number>()
  for (const c of clients) {
    const key = c.createdAt.toISOString().slice(0, 7)
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }

  const points: MonthlyClientGrowthPoint[] = []
  const cursor = new Date(since)
  for (let i = 0; i < months; i++) {
    const key = cursor.toISOString().slice(0, 7)
    points.push({ month: key, count: buckets.get(key) ?? 0 })
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return points
}
