import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { TenantProvisioningSummary } from "./super-admin-metrics"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function TenantProvisioningCard({ summary }: { summary: TenantProvisioningSummary }) {
  return (
    <Card>
      <CardHeader><CardTitle>Tenant Provisioning</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-surface-900">{summary.newThisMonth}</p>
            <p className="text-xs text-surface-500">New This Month</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">{summary.trial}</p>
            <p className="text-xs text-surface-500">Trial</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">{summary.suspended}</p>
            <p className="text-xs text-surface-500">Suspended</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-surface-400">Pending verification and deletion queues aren&apos;t tracked yet.</p>
        <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED} className="mt-3">View Provisioning Center</Button>
      </CardContent>
    </Card>
  )
}
