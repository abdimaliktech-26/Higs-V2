import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import {
  Building2, MapPin, Layers, ClipboardList, Users, ShieldCheck, FileText, PenSquare, Scale, Puzzle,
} from "lucide-react"
import { ChecklistItem } from "./checklist-item"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function OrganizationInformationItem({ name, timezone }: { name: string; timezone: string | null }) {
  return (
    <ChecklistItem icon={Building2} title="Organization Information" description="Organization name and timezone are real; legal name, tax ID, provider number, website, and address aren't tracked yet." href="/settings/organization" linkLabel="Open Organization Settings">
      <div className="grid max-w-md grid-cols-2 gap-2 text-xs">
        <div><p className="text-surface-400">Organization Name</p><p className="font-medium text-surface-900">{name}</p></div>
        <div><p className="text-surface-400">Time Zone</p><p className="font-medium text-surface-900">{timezone || "Not set"}</p></div>
        <div><p className="text-surface-400">Legal Name</p><Input disabled placeholder="Not configured" title={NOT_WIRED} className="h-7 text-xs" /></div>
        <div><p className="text-surface-400">Tax ID / Provider #</p><Input disabled placeholder="Not configured" title={NOT_WIRED} className="h-7 text-xs" /></div>
      </div>
    </ChecklistItem>
  )
}

export function LocationsItem({ locations }: { locations: string[] }) {
  return (
    <ChecklistItem icon={MapPin} title="Locations" description={locations.length > 0 ? `${locations.length} location${locations.length !== 1 ? "s" : ""} configured.` : "No locations configured yet."} href="/settings/organization?tab=locations" linkLabel="Manage Locations">
      {locations.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {locations.map((l) => <Badge key={l} variant="secondary" size="sm">{l}</Badge>)}
        </div>
      )}
    </ChecklistItem>
  )
}

export function DepartmentsItem({ departments }: { departments: string[] }) {
  return (
    <ChecklistItem icon={Layers} title="Departments" description={`${departments.length} department${departments.length !== 1 ? "s" : ""} configured.`} href="/settings/organization?tab=departments" linkLabel="Manage Departments">
      <div className="flex flex-wrap gap-1.5">
        {departments.map((d) => <Badge key={d} variant="secondary" size="sm">{d}</Badge>)}
      </div>
    </ChecklistItem>
  )
}

export function ProgramsItem({ programNames }: { programNames: string[] }) {
  return (
    <ChecklistItem icon={ClipboardList} title="Programs" description={programNames.length > 0 ? `${programNames.length} program${programNames.length !== 1 ? "s" : ""} on file (read-only here).` : "No programs configured yet."} href="/settings/organization?tab=programs" linkLabel="View Programs">
      {programNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {programNames.map((p) => <Badge key={p} variant="secondary" size="sm">{p}</Badge>)}
        </div>
      )}
    </ChecklistItem>
  )
}

export function StaffSetupItem({ memberCount }: { memberCount: number }) {
  return (
    <ChecklistItem icon={Users} title="Staff Setup" description={`${memberCount} staff member${memberCount !== 1 ? "s" : ""} in this organization.`} href="/settings/users" linkLabel="Manage Staff" />
  )
}

export function SecuritySetupItem({ mfaEnabled, ssoEnabled }: { mfaEnabled: boolean; ssoEnabled: boolean }) {
  return (
    <ChecklistItem icon={ShieldCheck} title="Security Setup" description="Multi-factor authentication and single sign-on aren't wired to a real backend yet." status={mfaEnabled || ssoEnabled ? "Partially Enabled" : "Not Enabled"} statusVariant={mfaEnabled || ssoEnabled ? "warning" : "secondary"} href="/settings/organization?tab=security" linkLabel="Open Security Settings" />
  )
}

export function DocumentSetupItem({ defaultPacketType }: { defaultPacketType: string | null }) {
  return (
    <ChecklistItem icon={FileText} title="PDF & Document Setup" description={defaultPacketType ? `Default packet type: ${defaultPacketType.replace(/_/g, " ")}` : "No default packet type configured."} href="/templates" linkLabel="Open Templates & Forms" />
  )
}

export function SignatureWorkflowItem() {
  return <ChecklistItem icon={PenSquare} title="Signature Workflow" description="Configure signature requests and requirements in the real Signature Workflow page." href="/signatures" linkLabel="Open Signature Workflow" />
}

export function ComplianceRulesItem() {
  return <ChecklistItem icon={Scale} title="Compliance Rules" description="Manage validation rules in the Compliance Rules Engine." href="/compliance-rules-engine" linkLabel="Open Compliance Rules Engine" />
}

export function IntegrationsItem() {
  return <ChecklistItem icon={Puzzle} title="Integrations" description="No integrations are configured yet — the catalog is presentation-only today." status="Not Configured" statusVariant="secondary" href="/integrations" linkLabel="Open Integrations" />
}
