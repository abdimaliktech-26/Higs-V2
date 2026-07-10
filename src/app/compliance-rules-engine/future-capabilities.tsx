import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Workflow, Sparkles, History, FlaskConical, Rocket, BarChart3, type LucideIcon } from "lucide-react"

interface Capability { icon: LucideIcon; title: string; description: string }

const capabilities: Capability[] = [
  { icon: Workflow, title: "Visual Rule Builder", description: "Drag-and-drop trigger/condition/action canvas isn't available yet." },
  { icon: Sparkles, title: "AI Rule Generation", description: "AI-authored rules aren't available yet." },
  { icon: History, title: "Rule Versioning", description: "Version history and rollback aren't tracked yet." },
  { icon: FlaskConical, title: "Test & Simulation", description: "Dry-run rule testing isn't available yet." },
  { icon: Rocket, title: "Publishing Workflow", description: "Draft/publish states aren't tracked yet." },
  { icon: BarChart3, title: "Execution Analytics", description: "Runtime, execution counts, and failure trends aren't tracked yet." },
]

export function FutureCapabilitiesGrid() {
  return (
    <Card>
      <CardHeader><CardTitle>Future Capabilities</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {capabilities.map((c) => (
            <div key={c.title} className="rounded-lg border border-surface-100 p-4 opacity-60" title="Not part of this presentation pass — no backend source yet">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-surface-100 text-surface-400"><c.icon className="h-4 w-4" /></div>
              <p className="mt-2 text-sm font-medium text-surface-700">{c.title}</p>
              <p className="mt-1 text-xs text-surface-400">{c.description}</p>
              <span className="mt-2 inline-block rounded bg-surface-100 px-2 py-0.5 text-[10px] font-medium text-surface-500">Coming Soon</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
