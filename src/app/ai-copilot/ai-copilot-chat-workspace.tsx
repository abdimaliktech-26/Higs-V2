import { Send, Mic } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

const quickPrompts = ["Analyze Packet", "Analyze Client", "Run Validation", "Audit Readiness", "Compare Documents", "Missing Signature"]

export function AiChatPromptCard() {
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2">
          <Input
            placeholder="Ask Higsi AI anything about your clients, packets, documents, compliance, or audits…"
            disabled
            title={NOT_WIRED}
            className="flex-1"
          />
          <Button variant="ghost" size="icon-sm" disabled title={NOT_WIRED}><Mic className="h-4 w-4" /></Button>
          <Button variant="primary" size="icon-sm" disabled title={NOT_WIRED}><Send className="h-4 w-4" /></Button>
        </div>
        <div className="mt-3 flex flex-wrap gap-2">
          {quickPrompts.map((p) => (
            <button key={p} disabled title={NOT_WIRED} className="rounded-lg border border-surface-200 px-3 py-1.5 text-xs text-surface-500 opacity-60 cursor-not-allowed">
              {p}
            </button>
          ))}
        </div>
        <p className="mt-3 text-xs text-surface-400">Conversational AI chat isn&apos;t available yet. Real AI analyses are shown below.</p>
      </CardContent>
    </Card>
  )
}
