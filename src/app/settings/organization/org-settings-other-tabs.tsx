import Link from "next/link"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { StatusChip } from "@/components/ui/status-chip"
import { EmptyState } from "@/components/ui/states"
import { Layers, Shield, Lock, Key, Clock, MapPin, Users2, Sparkles } from "lucide-react"
import type { OrgProgramRow } from "./org-settings-data"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function ComingSoonTab({ title, description }: { title: string; description: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent>
        <EmptyState className="py-10" icon={<Sparkles className="h-6 w-6" />} title="Coming soon" description={description} />
      </CardContent>
    </Card>
  )
}

export function DepartmentsTab({ departments }: { departments: string[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Layers className="h-5 w-5 text-surface-400" />
          <CardTitle>Departments</CardTitle>
          <CardDescription>Manage organization departments for staff assignment</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex flex-wrap gap-2">
          {departments.map((d) => (
            <span key={d} className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-3 py-1 text-xs font-medium text-surface-700">
              {d}
            </span>
          ))}
          <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Layers className="h-4 w-4" /> Add Department</Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function LocationsTab({ locations }: { locations: string[] }) {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <MapPin className="h-5 w-5 text-surface-400" />
          <CardTitle>Locations</CardTitle>
          <CardDescription>Physical or service locations for this organization</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        {locations.length === 0 ? (
          <EmptyState className="py-8" icon={<MapPin className="h-6 w-6" />} title="No locations configured" description="Locations added here will be available for assignment across the organization." />
        ) : (
          <div className="flex flex-wrap gap-2">
            {locations.map((l) => (
              <span key={l} className="inline-flex items-center gap-1 rounded-full bg-surface-100 px-3 py-1 text-xs font-medium text-surface-700">{l}</span>
            ))}
          </div>
        )}
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED} className="mt-3"><MapPin className="h-4 w-4" /> Add Location</Button>
      </CardContent>
    </Card>
  )
}

export function ProgramsTab({ programs }: { programs: OrgProgramRow[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Programs</CardTitle>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Enable New Program</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200">
                {["Program", "Code", "Status"].map((header) => (
                  <th key={header} className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500 last:pr-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {programs.length === 0 ? (
                <tr>
                  <td colSpan={3} className="py-12 text-center text-sm font-medium text-surface-900">No programs configured yet</td>
                </tr>
              ) : programs.map((program) => (
                <tr key={program.id}>
                  <td className="py-3 pr-4 font-medium text-surface-900">{program.name}</td>
                  <td className="py-3 pr-4 text-surface-700">{program.code}</td>
                  <td className="py-3 pr-4 last:pr-0"><StatusChip status={program.isActive ? "active" : "inactive"} size="sm" /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

export function SecurityTab() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Shield className="h-5 w-5 text-surface-400" />
          <CardTitle>Security</CardTitle>
          <CardDescription>Authentication and access control settings</CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-surface-100 p-4">
          <div className="flex items-center gap-3">
            <Lock className="h-5 w-5 text-surface-400" />
            <div>
              <p className="text-sm font-medium text-surface-900">Multi-Factor Authentication (MFA)</p>
              <p className="text-xs text-surface-500">Require MFA for all staff accounts</p>
            </div>
          </div>
          <span className="text-xs text-surface-400 bg-surface-100 px-2 py-1 rounded">Coming soon</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-surface-100 p-4">
          <div className="flex items-center gap-3">
            <Key className="h-5 w-5 text-surface-400" />
            <div>
              <p className="text-sm font-medium text-surface-900">Single Sign-On (SSO)</p>
              <p className="text-xs text-surface-500">SAML/OIDC integration for enterprise SSO</p>
            </div>
          </div>
          <span className="text-xs text-surface-400 bg-surface-100 px-2 py-1 rounded">Coming soon</span>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-surface-100 p-4">
          <div className="flex items-center gap-3">
            <Clock className="h-5 w-5 text-surface-400" />
            <div>
              <p className="text-sm font-medium text-surface-900">Session Timeout</p>
              <p className="text-xs text-surface-500">8 hours (default)</p>
            </div>
          </div>
          <span className="text-xs text-surface-500">8h</span>
        </div>
      </CardContent>
    </Card>
  )
}

export function RolesPermissionsTab() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Users2 className="h-5 w-5 text-surface-400" />
          <CardTitle>Roles & Permissions</CardTitle>
          <CardDescription>Manage staff roles and organization membership</CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-surface-500">Role assignment and membership management happens in User Management.</p>
        <Link href="/settings/users"><Button variant="primary" size="sm">Open User &amp; Role Management</Button></Link>
      </CardContent>
    </Card>
  )
}
