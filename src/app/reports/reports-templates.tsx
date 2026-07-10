import Link from "next/link"
import {
  Shield, FileCheck, PenSquare, GraduationCap, Pill, FolderOpen, ClipboardList,
  FileDown, FileSpreadsheet, LayoutDashboard, Link2, Mail, type LucideIcon,
} from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { reportTypes } from "./reports-report-types"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function PopularTemplates() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-surface-900">Popular Templates</h3>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reportTypes.map((t) => (
            <div key={t.id} className="flex flex-col rounded-xl border border-surface-200 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-brand-50 text-brand-600">
                <t.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-surface-900">{t.label}</p>
              <p className="mt-1 flex-1 text-xs text-surface-500">{t.description}</p>
              <Link href={`/reports?report=${t.id}`} className="mt-3">
                <Button variant="secondary" size="sm" fullWidth>Use Template</Button>
              </Link>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

interface ComplianceShortcut {
  label: string
  description: string
  icon: LucideIcon
  href?: string
}

const complianceShortcuts: ComplianceShortcut[] = [
  { label: "Compliance", description: "Complete audit readiness package", icon: Shield, href: "/reports?report=compliance" },
  { label: "Annual Reviews", description: "Track annual reviews", icon: FileCheck },
  { label: "Missing Signatures", description: "Identify unsigned documents", icon: PenSquare },
  { label: "Staff Training", description: "Staff certifications expiring", icon: GraduationCap },
  { label: "Medication", description: "Medication administration", icon: Pill },
  { label: "Service Docs", description: "Documentation completion check", icon: FolderOpen, href: "/reports?report=documents" },
  { label: "Person-Centered Plan", description: "PCP compliance check", icon: ClipboardList },
]

export function Compliance245DGrid() {
  return (
    <Card>
      <CardContent className="p-6">
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-base font-semibold text-surface-900">245D Reports</h3>
          <Badge variant="secondary">Built for Minnesota 245D Providers</Badge>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {complianceShortcuts.map((s) => (
            <div key={s.label} className="flex flex-col rounded-xl border border-surface-200 p-4">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-surface-600">
                <s.icon className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-surface-900">{s.label}</p>
              <p className="mt-1 flex-1 text-xs text-surface-500">{s.description}</p>
              {s.href ? (
                <Link href={s.href} className="mt-3">
                  <Button variant="secondary" size="sm" fullWidth>Generate</Button>
                </Link>
              ) : (
                <Button variant="secondary" size="sm" fullWidth disabled title={NOT_WIRED} className="mt-3">Generate</Button>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

interface ExportOption { label: string; icon: LucideIcon }

const exportOptions: ExportOption[] = [
  { label: "PDF", icon: FileDown },
  { label: "Excel", icon: FileSpreadsheet },
  { label: "Interactive Dashboard", icon: LayoutDashboard },
  { label: "Secure Link", icon: Link2 },
  { label: "Email Delivery", icon: Mail },
]

export function QuickExport() {
  return (
    <Card>
      <CardContent className="p-6">
        <h3 className="mb-4 text-base font-semibold text-surface-900">Quick Export</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {exportOptions.map((o) => (
            <div key={o.label} className="flex flex-col items-center gap-2 rounded-xl border border-surface-200 p-4 text-center">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-surface-100 text-surface-600">
                <o.icon className="h-5 w-5" />
              </div>
              <p className="text-sm font-medium text-surface-900">{o.label}</p>
              <Button variant="secondary" size="sm" disabled title={NOT_WIRED} fullWidth>Export</Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
