import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  KeyRound, Webhook, Puzzle, ShieldCheck, Cloud, Send, PenSquare, CreditCard, Sparkles, PlugZap, Activity, Network, type LucideIcon,
} from "lucide-react"

interface Capability { icon: LucideIcon; title: string }

const capabilities: Capability[] = [
  { icon: KeyRound, title: "API Keys" },
  { icon: Webhook, title: "Webhooks" },
  { icon: Puzzle, title: "Custom Integrations" },
  { icon: ShieldCheck, title: "SSO Providers" },
  { icon: Cloud, title: "Cloud Storage" },
  { icon: Send, title: "Email/SMS Delivery" },
  { icon: PenSquare, title: "E-signature Providers" },
  { icon: CreditCard, title: "Billing Providers" },
  { icon: Sparkles, title: "AI Providers" },
  { icon: PlugZap, title: "Connection Testing" },
  { icon: Activity, title: "Sync Monitoring" },
  { icon: Network, title: "Dependency Map" },
]

export function FutureCapabilitiesGrid() {
  return (
    <Card>
      <CardHeader><CardTitle>Future Capabilities</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
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
