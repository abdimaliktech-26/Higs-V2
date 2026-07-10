import { Bot, MessagesSquare } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

const agentLabels = [
  "Compliance Agent",
  "Audit Agent",
  "Validation Agent",
  "Document Agent",
  "Scheduling Agent",
  "Reporting Agent",
  "Knowledge Agent",
]

const suggestedPrompts = [
  "Explain why this packet failed validation.",
  "Show all missing signatures due this week.",
  "Generate an executive audit summary.",
  "Which clients are highest risk?",
  "Compare intake packet versions.",
]

export function AiAgentsCard() {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><Bot className="h-4 w-4 text-surface-400" /> AI Agents</CardTitle></CardHeader>
      <CardContent>
        <div className="space-y-2">
          {agentLabels.map((label) => (
            <div key={label} className="flex items-center justify-between rounded-lg border border-surface-100 p-3" title={NOT_WIRED}>
              <span className="text-sm text-surface-700">{label}</span>
              <span className="text-xs text-surface-400 bg-surface-100 px-2 py-0.5 rounded">Coming soon</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function ConversationHistoryCard() {
  return (
    <Card>
      <CardHeader><CardTitle className="flex items-center gap-2"><MessagesSquare className="h-4 w-4 text-surface-400" /> Conversation History</CardTitle></CardHeader>
      <CardContent>
        <EmptyState className="py-6" title="No saved conversations" description="Conversation history isn't tracked yet." />
      </CardContent>
    </Card>
  )
}

export function SuggestedPromptsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Suggested Prompts</CardTitle></CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {suggestedPrompts.map((p) => (
            <button key={p} disabled title={NOT_WIRED} className="rounded-full border border-surface-200 px-3 py-1.5 text-xs text-surface-500 opacity-60 cursor-not-allowed">
              {p}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
