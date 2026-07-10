import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Building2, SearchCheck } from "lucide-react"

export function IntegrationsOverviewCard() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Integrations Marketplace</h1>
        <Badge variant="secondary" size="sm">Not Configured</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-surface-500">Connect enterprise systems to automate workflows, synchronize data, and extend Higsi capabilities.</p>

      <Card className="mt-4">
        <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-surface-600">
            No third-party integrations are configured yet. The catalog below shows what will eventually connect here — everything is presentation-only until a real vendor connection exists.
          </p>
          <div className="flex shrink-0 gap-2">
            <Link href="/settings/organization"><Button variant="secondary" size="sm"><Building2 className="h-4 w-4" /> Organization Settings</Button></Link>
            <Link href="/audit"><Button variant="secondary" size="sm"><SearchCheck className="h-4 w-4" /> Audit Logs</Button></Link>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
