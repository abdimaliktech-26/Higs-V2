import type { PlatformOrganizationRow } from "./super-admin-data"

export interface PlatformKpis {
  totalOrganizations: number
  activeOrganizations: number
  totalUsers: number
  totalClients: number
  aiRequestsToday: number
}

export function derivePlatformKpis(
  orgs: PlatformOrganizationRow[],
  totals: { totalUsers: number; totalClients: number },
  aiUsage: { extractionsToday: number }
): PlatformKpis {
  return {
    totalOrganizations: orgs.length,
    activeOrganizations: orgs.filter((o) => o.status === "ACTIVE").length,
    totalUsers: totals.totalUsers,
    totalClients: totals.totalClients,
    aiRequestsToday: aiUsage.extractionsToday,
  }
}

export interface TenantProvisioningSummary {
  newThisMonth: number
  trial: number
  suspended: number
}

export function deriveTenantProvisioning(orgs: PlatformOrganizationRow[]): TenantProvisioningSummary {
  const now = new Date()
  const newThisMonth = orgs.filter((o) => {
    const d = new Date(o.createdAt)
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
  }).length
  const trial = orgs.filter((o) => o.status === "TRIAL").length
  const suspended = orgs.filter((o) => o.status === "SUSPENDED").length

  return { newThisMonth, trial, suspended }
}
