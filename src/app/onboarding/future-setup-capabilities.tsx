import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  Palette, Sparkles, DatabaseZap, Rocket, Save, SaveAll, Gauge, MessageCircleQuestion, type LucideIcon,
} from "lucide-react"

interface Capability { icon: LucideIcon; title: string }

const capabilities: Capability[] = [
  { icon: Palette, title: "Brand Identity" },
  { icon: Sparkles, title: "AI Configuration" },
  { icon: DatabaseZap, title: "Data Migration" },
  { icon: Rocket, title: "Launch Organization" },
  { icon: Save, title: "Save Draft / Resume Later" },
  { icon: SaveAll, title: "Setup Progress Persistence" },
  { icon: Gauge, title: "Automated Readiness Scoring" },
  { icon: MessageCircleQuestion, title: "AI Setup Assistant" },
]

export function FutureSetupCapabilitiesGrid() {
  return (
    <Card>
      <CardHeader><CardTitle>Future Setup Capabilities</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {capabilities.map((c) => (
            <div key={c.title} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center opacity-60" title="Not part of this presentation pass — no backend source yet">
              <c.icon className="h-4 w-4 text-surface-400" />
              <span className="text-xs font-medium text-surface-600">{c.title}</span>
              <span className="rounded bg-surface-100 px-1.5 py-0.5 text-[10px] font-medium text-surface-500">Coming Soon</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
