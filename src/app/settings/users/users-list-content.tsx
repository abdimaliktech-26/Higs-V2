import { getOrgUsers, updateOrgUser } from "@/lib/actions/users"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { StatusChip } from "@/components/ui/status-chip"
import { Badge } from "@/components/ui/badge"
import { EmptyState, ErrorState } from "@/components/ui/states"
import { Button } from "@/components/ui/button"
import { UserPlus, Users, Shield, Mail, Calendar, ChevronRight } from "lucide-react"
import { formatDate, getInitials } from "@/lib/utils"
import { UserRole } from "@prisma/client"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"

const roleLabels: Record<string, string> = {
  SUPER_ADMIN: "Super Admin", ORG_ADMIN: "Org Admin", COMPLIANCE_DIRECTOR: "Compliance Director",
  CASE_MANAGER: "Case Manager", DSP: "DSP / Staff", NURSE: "Nurse",
  BILLING_ADMIN: "Billing Admin", GUARDIAN: "Guardian / Family", EXTERNAL_CASE_MANAGER: "Ext. Case Manager",
}

interface Props { orgId: string }

export async function UsersListContent({ orgId }: Props) {
  let members: Awaited<ReturnType<typeof getOrgUsers>>
  try { members = await getOrgUsers(orgId) }
  catch (e) { return <ErrorState title="Error" description={(e as Error).message} /> }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">User Management</h1>
          <p className="mt-1 text-sm text-surface-500">{members.length} team member{members.length !== 1 ? "s" : ""}</p>
        </div>
        <Button><UserPlus className="h-4 w-4" /> Invite User</Button>
      </div>

      <Card>
        <CardContent className="p-0">
          {members.length === 0 ? (
            <div className="px-6 py-16">
              <EmptyState title="No team members" description="Invite users to join your organization" icon={<Users className="h-8 w-8" />} />
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-surface-200">
                    <th className="pb-3 pl-6 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">User</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Role</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Status</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Departments</th>
                    <th className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500">Joined</th>
                    <th className="pb-3 pr-6" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-100">
                  {members.map((m) => (
                    <tr key={m.id} className="hover:bg-surface-50 transition-colors">
                      <td className="py-3 pl-6 pr-4">
                        <div className="flex items-center gap-3">
                          <Avatar size="sm">
                            <AvatarFallback className="bg-brand-100 text-brand-700 text-xs" name={m.user.name || m.user.email} />
                          </Avatar>
                          <div>
                            <p className="font-medium text-surface-900">{m.user.name || "Unnamed"}</p>
                            <p className="text-xs text-surface-500">{m.user.email}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 pr-4">
                        <Badge variant={
                          m.role === "SUPER_ADMIN" ? "danger" :
                          m.role === "ORG_ADMIN" ? "default" :
                          m.role === "COMPLIANCE_DIRECTOR" ? "info" : "secondary"
                        } size="sm">
                          {roleLabels[m.role] || m.role}
                        </Badge>
                      </td>
                      <td className="py-3 pr-4"><StatusChip status={m.status.toLowerCase()} size="sm" /></td>
                      <td className="py-3 pr-4">
                        <div className="flex gap-1 flex-wrap">
                          {(m.departments as string[] || []).length > 0
                            ? (m.departments as string[]).map((d: string) => <Badge key={d} variant="outline" size="sm">{d}</Badge>)
                            : <span className="text-xs text-surface-400">—</span>
                          }
                        </div>
                      </td>
                      <td className="py-3 pr-4 text-xs text-surface-500">{formatDate(m.createdAt)}</td>
                      <td className="py-3 pr-6">
                        <form action={async () => {
                          "use server"
                          const newStatus = m.status === "ACTIVE" ? "DISABLED" : "ACTIVE"
                          await updateOrgUser(m.id, { status: newStatus as any })
                        }}>
                          <Button type="submit" variant="ghost" size="sm">
                            {m.status === "ACTIVE" ? "Deactivate" : "Activate"}
                          </Button>
                        </form>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Role Definitions</CardTitle>
          <CardDescription>Permission levels from the Role & Permission Matrix</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {[
              { role: "Super Admin", label: "Full platform access", color: "danger" },
              { role: "Org Admin", label: "Full organization access, user management, settings", color: "default" },
              { role: "Compliance Director", label: "Compliance workflows, validation, audits, reports", color: "info" },
              { role: "Case Manager", label: "Assigned client packets, PDF editing, signatures", color: "secondary" },
              { role: "DSP / Staff", label: "Limited assigned client access, read documents", color: "secondary" },
              { role: "Nurse", label: "Clinical documents, assigned client access", color: "secondary" },
              { role: "Billing Admin", label: "Billing reports, financial data", color: "secondary" },
              { role: "Guardian / Family", label: "Public portal access (stubbed)", color: "secondary" },
              { role: "External Case Manager", label: "External portal view (stubbed)", color: "secondary" },
            ].map((r) => (
              <div key={r.role} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
                <div className="flex items-center gap-3">
                  <Shield className={`h-5 w-5 ${
                    r.color === "danger" ? "text-danger-500" : r.color === "default" ? "text-brand-600" : r.color === "info" ? "text-sky-600" : "text-surface-400"
                  }`} />
                  <span className="text-sm font-medium text-surface-900">{r.role}</span>
                </div>
                <span className="text-xs text-surface-500">{r.label}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
