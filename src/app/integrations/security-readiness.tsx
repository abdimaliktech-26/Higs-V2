import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Fingerprint, ShieldCheck, SearchCheck, Link2 } from "lucide-react"

export function SecurityReadinessCard({ mfaEnabled, ssoEnabled }: { mfaEnabled: boolean; ssoEnabled: boolean }) {
  const rows = [
    { icon: Fingerprint, label: "Multi-Factor Authentication", enabled: mfaEnabled },
    { icon: ShieldCheck, label: "Single Sign-On", enabled: ssoEnabled },
    { icon: SearchCheck, label: "Audit Logging", enabled: true },
    { icon: Link2, label: "Signed File Access", enabled: true },
  ]

  return (
    <Card>
      <CardHeader><CardTitle>Security &amp; Readiness</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between rounded-lg border border-surface-100 p-3">
            <div className="flex items-center gap-2.5">
              <r.icon className={`h-4 w-4 ${r.enabled ? "text-success-500" : "text-surface-300"}`} />
              <span className="text-sm text-surface-700">{r.label}</span>
            </div>
            <Badge variant={r.enabled ? "success" : "secondary"} size="sm">{r.enabled ? "Enabled" : "Not Enabled"}</Badge>
          </div>
        ))}
        <div className="flex gap-2 pt-1">
          <Link href="/settings/organization" className="flex-1"><Button variant="secondary" size="sm" fullWidth>Organization Settings</Button></Link>
          <Link href="/audit" className="flex-1"><Button variant="secondary" size="sm" fullWidth>Audit Center</Button></Link>
        </div>
      </CardContent>
    </Card>
  )
}
