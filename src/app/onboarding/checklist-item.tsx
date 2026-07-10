import Link from "next/link"
import { Card, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ChevronRight, type LucideIcon } from "lucide-react"

interface ChecklistItemProps {
  icon: LucideIcon
  title: string
  description: string
  status?: string
  statusVariant?: "success" | "warning" | "secondary"
  href: string
  linkLabel?: string
  children?: React.ReactNode
}

export function ChecklistItem({ icon: Icon, title, description, status, statusVariant = "secondary", href, linkLabel = "Open", children }: ChecklistItemProps) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
              <Icon className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-semibold text-surface-900">{title}</p>
              <p className="mt-0.5 text-xs text-surface-500">{description}</p>
              {children && <div className="mt-3">{children}</div>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {status && <Badge variant={statusVariant} size="sm">{status}</Badge>}
            <Link href={href}><Button variant="secondary" size="sm">{linkLabel} <ChevronRight className="h-4 w-4" /></Button></Link>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
