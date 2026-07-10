import { resolvePortalPageContext } from "@/lib/portal/page-context"
import { getPortalCareTeam } from "@/lib/actions/portal-dashboard"
import { PortalShell } from "@/app/portal/portal-shell"
import { Card, CardContent } from "@/components/ui/card"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/ui/states"
import { Users, Building2, Mail } from "lucide-react"

export const dynamic = "force-dynamic"

export default async function PortalCareTeamPage({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const { client } = await searchParams
  const { clients, currentClientId } = await resolvePortalPageContext(client)

  if (!currentClientId) {
    return (
      <div className="flex min-h-screen items-center justify-center p-8">
        <EmptyState title="No portal access yet" description="You don't have active access to any client's information yet." icon={<Building2 className="h-8 w-8" />} />
      </div>
    )
  }

  const careTeam = await getPortalCareTeam(currentClientId)

  return (
    <PortalShell clients={clients} currentClientId={currentClientId}>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-surface-900">Care Team</h1>
          <p className="mt-1 text-sm text-surface-500">Staff currently assigned to support you</p>
        </div>

        <Card>
          <CardContent className="p-0">
            {careTeam.length === 0 ? (
              <div className="px-6 py-16">
                <EmptyState title="No care team assigned yet" description="No staff members are currently assigned." icon={<Users className="h-8 w-8" />} />
              </div>
            ) : (
              <div className="divide-y divide-surface-100">
                {careTeam.map((member) => (
                  <div key={member.id} className="flex items-center gap-3 px-6 py-4">
                    <Avatar size="sm">
                      <AvatarFallback className="bg-brand-100 text-xs text-brand-700" name={member.name} />
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-surface-900">{member.name}</p>
                      <p className="flex items-center gap-1 text-xs text-surface-500"><Mail className="h-3 w-3" /> {member.email}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {member.isPrimary && <Badge variant="default" size="sm">Primary</Badge>}
                      <Badge variant="outline" size="sm">{member.role}</Badge>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PortalShell>
  )
}
