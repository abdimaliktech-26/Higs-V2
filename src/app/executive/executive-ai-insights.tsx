import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Lightbulb } from "lucide-react"
import type { LeadershipFocusItem } from "./executive-metrics"

interface AiRecommendation { id: string; message: string }

export function AiInsightsCard({ recommendations }: { recommendations: AiRecommendation[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>AI Insights</CardTitle></CardHeader>
      <CardContent>
        {recommendations.length === 0 ? (
          <p className="text-sm text-surface-400">No open AI recommendations right now.</p>
        ) : (
          <ul className="space-y-3">
            {recommendations.slice(0, 4).map((r) => (
              <li key={r.id} className="flex items-start gap-2.5 text-sm text-surface-700">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning-500" />
                {r.message}
              </li>
            ))}
          </ul>
        )}
        <Link href="/ai-copilot" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">View all insights →</Link>
      </CardContent>
    </Card>
  )
}

export function LeadershipFocusCard({ items }: { items: LeadershipFocusItem[] }) {
  return (
    <Card>
      <CardHeader><CardTitle>What Leadership Should Focus On</CardTitle></CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-surface-400">Nothing urgent right now.</p>
        ) : (
          <ol className="space-y-3">
            {items.map((it, i) => (
              <li key={i} className="flex items-start gap-3 text-sm text-surface-700">
                <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-600 text-xs font-bold text-white">{i + 1}</span>
                {it.message}
              </li>
            ))}
          </ol>
        )}
        <Link href="/ai-copilot" className="mt-4 inline-block text-sm font-medium text-brand-600 hover:underline">View recommendations →</Link>
      </CardContent>
    </Card>
  )
}
