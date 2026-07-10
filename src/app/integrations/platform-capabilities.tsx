import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { KeyRound, HardDrive, Link2, ShieldAlert, SearchCheck, Fingerprint, ShieldCheck } from "lucide-react"

interface Capability {
  icon: typeof KeyRound
  label: string
  description: string
  enabled: boolean
}

export function PlatformCapabilitiesCard({ sentryConfigured }: { sentryConfigured: boolean }) {
  const capabilities: Capability[] = [
    { icon: KeyRound, label: "Credentials-Based Authentication", description: "Email + password sign-in via NextAuth", enabled: true },
    { icon: HardDrive, label: "Local Private File Storage", description: "Files stored on the application server, not a third-party cloud", enabled: true },
    { icon: Link2, label: "HMAC-Signed File URLs", description: "Time-limited signed links for document access", enabled: true },
    { icon: ShieldAlert, label: "Error Tracking (Sentry)", description: sentryConfigured ? "SENTRY_DSN is configured for this deployment" : "SENTRY_DSN is not configured for this deployment", enabled: sentryConfigured },
    { icon: SearchCheck, label: "Audit Logging", description: "Every sensitive action is recorded to the audit log", enabled: true },
    { icon: Fingerprint, label: "Multi-Factor Authentication", description: "Not enabled for this organization yet", enabled: false },
    { icon: ShieldCheck, label: "Single Sign-On", description: "Not enabled for this organization yet", enabled: false },
  ]

  return (
    <Card>
      <CardHeader><CardTitle>Current Platform Capabilities</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-surface-400">These are built into Higsi today — not third-party integrations.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {capabilities.map((c) => (
            <div key={c.label} className="flex items-start justify-between gap-3 rounded-lg border border-surface-100 p-3">
              <div className="flex min-w-0 items-start gap-2.5">
                <c.icon className={`mt-0.5 h-4 w-4 shrink-0 ${c.enabled ? "text-success-500" : "text-surface-300"}`} />
                <div className="min-w-0">
                  <p className="text-sm font-medium text-surface-900">{c.label}</p>
                  <p className="text-xs text-surface-400">{c.description}</p>
                </div>
              </div>
              <Badge variant={c.enabled ? "success" : "secondary"} size="sm" className="shrink-0">{c.enabled ? "Enabled" : "Not Enabled"}</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
