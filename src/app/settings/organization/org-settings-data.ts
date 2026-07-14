import { prisma } from "@/lib/db"
import { requireActiveOrganizationMembership } from "@/lib/live-authorization"

export interface OrgProgramRow {
  id: string
  name: string
  code: string
  isActive: boolean
}

/**
 * Read-only listing of an organization's real Program rows for the
 * Programs Configuration table. No mutation, no new business logic —
 * mirrors the same prisma.program.findMany pattern already used in
 * src/lib/actions/reports.ts.
 */
export async function getOrgPrograms(orgId: string): Promise<OrgProgramRow[]> {
  await requireActiveOrganizationMembership(orgId, "view organization programs")
  return prisma.program.findMany({
    where: { organizationId: orgId },
    select: { id: true, name: true, code: true, isActive: true },
    orderBy: { name: "asc" },
  })
}
