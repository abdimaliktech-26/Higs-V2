import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function SetupOverviewHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Organization Setup</h1>
        <Badge variant="secondary" size="sm">Checklist</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-surface-500">
        A guided checklist for configuring an existing organization in Higsi. This does not create, launch, or provision a new organization — it links you to the real settings pages where each area is actually configured.
      </p>

      <Card className="mt-4">
        <CardContent className="p-5">
          <p className="text-sm text-surface-600">
            This checklist isn&apos;t saved between visits — there&apos;s no draft or progress-tracking system yet. Each item below opens the real page where that setting lives.
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
