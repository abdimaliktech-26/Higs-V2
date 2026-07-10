import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Lightbulb } from "lucide-react"

interface AiRecommendation { id: string; message: string }

export function AnalyticsAiInsightsCard({ recommendations }: { recommendations: AiRecommendation[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Insights</CardTitle></CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <p className="text-sm text-surface-400">No open AI recommendations right now.</p>
        ) : (
          <ul className="space-y-2.5">
            {recommendations.slice(0, 5).map((r) => (
              <li key={r.id} className="flex items-start gap-2.5 text-sm text-surface-700">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                {r.message}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
