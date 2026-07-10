import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import {
  HeartPulse, DollarSign, ShieldAlert, LifeBuoy, Flag, Puzzle, Rocket, Cpu, Megaphone, type LucideIcon,
} from "lucide-react"

interface ComingSoonDef { icon: LucideIcon; title: string; description: string }

const sections: ComingSoonDef[] = [
  { icon: HeartPulse, title: "Platform Health", description: "Service-level uptime and latency monitoring (API Gateway, database, queues, OCR, etc.) isn't tracked yet." },
  { icon: DollarSign, title: "Billing & Revenue", description: "MRR, ARR, and subscription revenue tracking isn't available — no billing model exists yet." },
  { icon: ShieldAlert, title: "Security Center", description: "Platform-wide security scoring, failed logins, and MFA adoption aren't tracked yet." },
  { icon: LifeBuoy, title: "Support Operations", description: "Support ticket volume, SLA compliance, and CSAT scores aren't tracked yet." },
  { icon: Flag, title: "Feature Flag Center", description: "Feature flag rollout management isn't available yet." },
  { icon: Puzzle, title: "System Integrations", description: "Third-party integration status (Stripe, Twilio, DocuSign, etc.) isn't tracked yet." },
  { icon: Rocket, title: "Deployment Center", description: "Environment and release tracking isn't available yet." },
  { icon: Cpu, title: "Infrastructure Monitoring", description: "CPU, memory, and database performance monitoring isn't available yet." },
  { icon: Megaphone, title: "Global Announcements", description: "Platform-wide announcement broadcasting isn't available yet." },
]

export function SuperAdminComingSoonGrid() {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 xl:grid-cols-3">
      {sections.map((s) => (
        <Card key={s.title}>
          <CardHeader><CardTitle>{s.title}</CardTitle></CardHeader>
          <CardContent>
            <EmptyState className="py-6" icon={<s.icon className="h-6 w-6" />} title="Coming soon" description={s.description} />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}
