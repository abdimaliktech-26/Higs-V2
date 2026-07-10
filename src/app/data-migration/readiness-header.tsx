import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"

export function ReadinessHeader() {
  return (
    <div>
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold text-surface-900 tracking-tight">Data Import Readiness Center</h1>
        <Badge variant="secondary" size="sm">Manual Setup Only</Badge>
      </div>
      <p className="mt-1 max-w-2xl text-sm text-surface-500">
        Higsi currently supports manual client, packet, and document setup — one record at a time. There is no bulk migration engine yet. This page centralizes the real tools available today and clearly shows what isn&apos;t available.
      </p>

      <Card className="mt-4">
        <CardContent className="p-5">
          <p className="text-sm text-surface-600">
            This is not a data migration wizard — it&apos;s a launch-readiness overview. Everything below either links to a real, working page or is honestly labeled &quot;Coming Soon.&quot;
          </p>
        </CardContent>
      </Card>
    </div>
  )
}
