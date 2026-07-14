import Link from "next/link"
import { ShieldCheck, Fingerprint, KeyRound, Lock, Globe2 } from "lucide-react"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

const modules = [
  { label: "MFA Adoption", icon: Fingerprint },
  { label: "Password Policy", icon: KeyRound },
  { label: "Encryption", icon: Lock },
  { label: "Security Controls", icon: ShieldCheck },
  { label: "Browser Security", icon: Globe2 },
]

export function SecurityCenterCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Security Center</CardTitle></CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-surface-100 p-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-surface-100 text-surface-400">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <div>
            <p className="text-2xl font-bold text-surface-900">—</p>
            <p className="text-xs text-surface-500">Security score not yet available</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          {modules.map((m) => (
            <div key={m.label} className="rounded-lg border border-surface-100 p-3 text-center">
              <m.icon className="mx-auto h-4 w-4 text-surface-400" />
              <p className="mt-1 text-xs text-surface-500">{m.label}</p>
              <p className="mt-1 text-xs font-semibold text-surface-400">Coming soon</p>
            </div>
          ))}
        </div>

        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Run Security Audit</Button>
          <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Force Password Reset</Button>
          <Link href="/audit"><Button variant="secondary" size="sm">Review Access Logs</Button></Link>
        </div>
      </CardContent>
    </Card>
  )
}
