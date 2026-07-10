import Link from "next/link"
import { Sparkles, ShieldCheck } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { EmptyState } from "@/components/ui/states"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function AiPlatformAdvisorCard() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">AI Platform Advisor <Badge variant="info" size="sm">BETA</Badge></CardTitle>
      </CardHeader>
      <CardContent>
        <EmptyState
          className="py-6"
          icon={<Sparkles className="h-6 w-6" />}
          title="Platform-wide AI insights not yet available"
          description="Recommendations such as churn risk, storage warnings, and renewal alerts require platform-level AI analysis that isn't connected yet."
        />
      </CardContent>
    </Card>
  )
}

interface QuickAction { label: string; href?: string }

const quickActions: QuickAction[] = [
  { label: "Create Organization" },
  { label: "Broadcast Announcement" },
  { label: "Platform Settings" },
  { label: "View Audit Logs", href: "/audit" },
]

export function SuperAdminQuickActionsCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Quick Actions</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3">
          {quickActions.map((a) => (
            a.href ? (
              <Link key={a.label} href={a.href} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center hover:bg-surface-50">
                <ShieldCheck className="h-4 w-4 text-surface-500" />
                <span className="text-xs font-medium text-surface-700">{a.label}</span>
              </Link>
            ) : (
              <button key={a.label} disabled title={NOT_WIRED} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center opacity-50 cursor-not-allowed">
                <ShieldCheck className="h-4 w-4 text-surface-400" />
                <span className="text-xs font-medium text-surface-500">{a.label}</span>
              </button>
            )
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

export function GenerateReportsCard() {
  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <Button variant="primary" size="sm" fullWidth disabled title={NOT_WIRED}>Generate Executive Report</Button>
        <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Weekly Platform Summary</Button>
        <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Ask Higsi AI</Button>
      </CardContent>
    </Card>
  )
}
