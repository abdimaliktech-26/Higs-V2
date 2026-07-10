import { applyRecommendation } from "@/lib/actions/ai"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"
import { AlertTriangle, Lightbulb, ThumbsUp, X, CheckCircle2 } from "lucide-react"

type Recommendation = {
  id: string
  type: string
  message: string
  confidence: number
  status: string
  packet: { client: { firstName: string; lastName: string } | null } | null
  packetDocument: { documentTemplate: { name: string } } | null
}

export function ValidationAnalysisCard({ recommendations }: { recommendations: Recommendation[] }) {
  const open = recommendations.filter((r) => r.status === "open")

  return (
    <Card>
      <CardHeader>
        <CardTitle>Validation Analysis</CardTitle>
        <CardDescription>
          Detailed compliance scoring, impact breakdowns, and source citations aren&apos;t tracked yet — showing real AI recommendations from document extraction and packet analysis below.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <EmptyState className="py-10" icon={<Lightbulb className="h-6 w-6" />} title="No recommendations yet" description="Recommendations will appear after running AI analysis on documents and packets." />
        ) : (
          <div className="space-y-3">
            {recommendations.map((rec) => (
              <div key={rec.id} className={`rounded-lg border p-4 ${
                rec.status === "applied" ? "border-success-100 bg-success-50/50" :
                rec.status === "dismissed" ? "border-surface-100 opacity-60" : "border-surface-100"
              }`}>
                <div className="flex items-start justify-between gap-4">
                  <div className="flex min-w-0 items-start gap-3">
                    {rec.type === "compliance" ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-danger-500" /> :
                     rec.type === "missing_data" ? <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-warning-500" /> :
                     <Lightbulb className="mt-0.5 h-5 w-5 shrink-0 text-brand-500" />}
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-surface-900">{rec.message}</p>
                        <Badge variant={rec.type === "compliance" ? "danger" : rec.type === "missing_data" ? "warning" : "default"} size="sm">{rec.type}</Badge>
                      </div>
                      <div className="mt-1 flex items-center gap-3 text-xs text-surface-500">
                        <span>Confidence: {Math.round(rec.confidence * 100)}%</span>
                        {rec.packet?.client && <span>{rec.packet.client.firstName} {rec.packet.client.lastName}</span>}
                        {rec.packetDocument && <span>{rec.packetDocument.documentTemplate.name}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {rec.status === "open" && (
                      <>
                        <form action={async () => { "use server"; await applyRecommendation(rec.id, "applied") }}>
                          <Button type="submit" variant="ghost" size="icon-sm" title="Apply"><ThumbsUp className="h-4 w-4 text-success-500" /></Button>
                        </form>
                        <form action={async () => { "use server"; await applyRecommendation(rec.id, "dismissed") }}>
                          <Button type="submit" variant="ghost" size="icon-sm" title="Dismiss"><X className="h-4 w-4 text-surface-400" /></Button>
                        </form>
                      </>
                    )}
                    {rec.status === "applied" && <CheckCircle2 className="h-4 w-4 text-success-500" />}
                    {rec.status === "dismissed" && <X className="h-4 w-4 text-surface-300" />}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
        {open.length > 0 && <p className="mt-3 text-xs text-surface-400">{open.length} open recommendation{open.length !== 1 ? "s" : ""}</p>}
      </CardContent>
    </Card>
  )
}
