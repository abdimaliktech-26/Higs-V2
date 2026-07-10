import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import type { PlatformAiUsage } from "./super-admin-data"

export function SuperAdminAiOperationsCard({ usage }: { usage: PlatformAiUsage }) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Operations</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-surface-900">{usage.extractionsToday}</p>
            <p className="text-xs text-surface-500">Requests Today</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">{usage.extractionsTotal}</p>
            <p className="text-xs text-surface-500">Total Extractions</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">{usage.openRecommendations}</p>
            <p className="text-xs text-surface-500">Open Recommendations</p>
          </div>
        </div>
        <p className="mt-3 text-xs text-surface-400">Token usage, cost, and per-model breakdown aren&apos;t tracked yet.</p>
      </CardContent>
    </Card>
  )
}
