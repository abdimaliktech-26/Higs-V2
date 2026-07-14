import { CheckCircle2, Lock } from "lucide-react"
import { Card, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"

export default function PortalActivationSuccessPage() {
  return (
    <div className="flex min-h-screen flex-col bg-navy-900">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="flex w-full max-w-[480px] flex-col items-center">
          <div className="mb-8 flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white shadow-lg">
              <span className="text-2xl font-bold text-brand-700">H</span>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white">Higsi</h1>
              <p className="text-sm text-navy-300">Client Portal</p>
            </div>
          </div>
          <Card className="w-full">
            <CardHeader className="items-center text-center">
              <div className="mb-2 flex h-12 w-12 items-center justify-center rounded-full bg-success-50">
                <CheckCircle2 className="h-6 w-6 text-success-600" />
              </div>
              <CardTitle>Your account is ready</CardTitle>
              <CardDescription>
                Portal access has been activated. Signing in to view your information — the client portal dashboard — is coming soon. Your care team can see that your access is active.
              </CardDescription>
            </CardHeader>
          </Card>
          <div className="mt-8 flex items-center gap-2 text-xs text-navy-400">
            <Lock className="h-3 w-3" />
            Secure portal access
          </div>
        </div>
      </div>
    </div>
  )
}
