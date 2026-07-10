import { applyRecommendation } from "@/lib/actions/ai"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Lightbulb, ThumbsUp, X, CheckCircle2 } from "lucide-react"

export function AiSummaryCard({ summary }: { summary: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Summary</CardTitle></CardHeader>
      <CardContent>
        <p className="text-sm text-surface-700">{summary}</p>
      </CardContent>
    </Card>
  )
}

type Recommendation = { id: string; type: string; message: string; confidence: number; status: string }

export function AiRecommendationsCard({ recommendations }: { recommendations: Recommendation[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Recommendations</CardTitle></CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <p className="text-sm text-surface-400">No recommendations for this document.</p>
        ) : (
          <ul className="space-y-2.5">
            {recommendations.map((r) => (
              <li key={r.id} className={`flex items-start justify-between gap-3 rounded-lg border p-3 ${r.status === "applied" ? "border-success-100 bg-success-50/50" : r.status === "dismissed" ? "border-surface-100 opacity-60" : "border-surface-100"}`}>
                <div className="flex min-w-0 items-start gap-2">
                  <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                  <div className="min-w-0">
                    <p className="text-sm text-surface-800">{r.message}</p>
                    <div className="mt-1 flex items-center gap-2">
                      <Badge variant="secondary" size="sm">{r.type}</Badge>
                      <span className="text-xs text-surface-400">Confidence: {Math.round(r.confidence * 100)}%</span>
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {r.status === "open" ? (
                    <>
                      <form action={async () => { "use server"; await applyRecommendation(r.id, "applied") }}>
                        <Button type="submit" variant="ghost" size="icon-sm" title="Apply"><ThumbsUp className="h-4 w-4 text-success-500" /></Button>
                      </form>
                      <form action={async () => { "use server"; await applyRecommendation(r.id, "dismissed") }}>
                        <Button type="submit" variant="ghost" size="icon-sm" title="Dismiss"><X className="h-4 w-4 text-surface-400" /></Button>
                      </form>
                    </>
                  ) : r.status === "applied" ? (
                    <CheckCircle2 className="h-4 w-4 text-success-500" />
                  ) : (
                    <X className="h-4 w-4 text-surface-300" />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
