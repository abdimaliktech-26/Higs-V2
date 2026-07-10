import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  ShieldCheck, Mail, MessageSquare, PenSquare, Phone, Sparkles, Cloud, Send, CreditCard, FolderKanban, type LucideIcon,
} from "lucide-react"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface CatalogVendor {
  name: string
  category: string
  icon: LucideIcon
}

const vendors: CatalogVendor[] = [
  { name: "Microsoft Entra ID", category: "Identity", icon: ShieldCheck },
  { name: "Google Workspace", category: "Productivity", icon: Mail },
  { name: "Slack", category: "Communications", icon: MessageSquare },
  { name: "DocuSign", category: "Documents", icon: PenSquare },
  { name: "Twilio", category: "Communications", icon: Phone },
  { name: "OpenAI", category: "AI", icon: Sparkles },
  { name: "AWS S3", category: "Storage", icon: Cloud },
  { name: "SendGrid", category: "Communications", icon: Send },
  { name: "Stripe", category: "Billing", icon: CreditCard },
  { name: "OneDrive / SharePoint", category: "Storage", icon: FolderKanban },
]

export function IntegrationsCatalogCard() {
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-base font-semibold text-surface-900">Available Integrations Catalog</h2>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {vendors.map((v) => (
          <Card key={v.name}>
            <CardContent className="flex flex-col gap-3 p-4">
              <div className="flex items-center justify-between">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-surface-500">
                  <v.icon className="h-5 w-5" />
                </div>
                <Badge variant="secondary" size="sm">Not Connected</Badge>
              </div>
              <div>
                <p className="text-sm font-semibold text-surface-900">{v.name}</p>
                <p className="text-xs text-surface-400">{v.category}</p>
              </div>
              <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED}>Connect — Coming Soon</Button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  )
}
