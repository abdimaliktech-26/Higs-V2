import { updateOrgSettings } from "@/lib/actions/users"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { StatusChip } from "@/components/ui/status-chip"
import { Checkbox } from "@/components/ui/checkbox"
import { PDFViewerPlaceholder } from "@/components/ui/pdf-controls"
import { Building2, Save, Upload, Eye } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { OrgProgramRow } from "./org-settings-data"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface OrgLike {
  id: string
  name: string
  createdAt: Date
  settings: unknown
}

export function OrgSettingsProfileTab({ org, programs }: { org: OrgLike; programs: OrgProgramRow[] }) {
  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)]">
      <OrganizationProfileCard org={org} />
      <ProgramsConfigurationCard programs={programs} />
      <BrandingPreviewCard />
    </div>
  )
}

function OrganizationProfileCard({ org }: { org: OrgLike }) {
  const settings = (org.settings as Record<string, unknown>) || {}

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Organization Profile</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="flex h-14 w-14 items-center justify-center rounded-xl bg-brand-50 text-brand-600">
            <Building2 className="h-7 w-7" />
          </div>
          <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Upload className="h-4 w-4" /> Upload Logo</Button>
        </div>

        <form action={async (form: FormData) => {
          "use server"
          await updateOrgSettings({ name: form.get("name") as string })
        }}>
          <Input label="Organization Name" name="name" defaultValue={org.name} />
          <Button type="submit" size="sm" className="mt-2"><Save className="h-4 w-4" /> Save Name</Button>
        </form>

        <Input label="Address" disabled placeholder="Not configured" title={NOT_WIRED} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Phone" disabled placeholder="Not configured" title={NOT_WIRED} />
          <Input label="Email" disabled placeholder="Not configured" title={NOT_WIRED} />
        </div>
        <Input label="Website" disabled placeholder="Not configured" title={NOT_WIRED} />

        <form action={async (form: FormData) => {
          "use server"
          await updateOrgSettings({ timezone: form.get("timezone") as string })
        }}>
          <Input label="Time Zone" name="timezone" defaultValue={(settings.timezone as string) || "America/Chicago"} />
          <Button type="submit" size="sm" className="mt-2"><Save className="h-4 w-4" /> Save Time Zone</Button>
        </form>

        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Provider Number" disabled placeholder="Not configured" title={NOT_WIRED} />
          <Input label="Tax ID (EIN)" disabled placeholder="Not configured" title={NOT_WIRED} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="Organization Since" value={formatDate(org.createdAt)} disabled />
          <Input label="Region" disabled placeholder="Not configured" title={NOT_WIRED} />
        </div>

        <a href="#branding-preview">
          <Button variant="secondary" size="sm" fullWidth><Eye className="h-4 w-4" /> Preview Branding</Button>
        </a>
      </CardContent>
    </Card>
  )
}

function ProgramsConfigurationCard({ programs }: { programs: OrgProgramRow[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Programs Configuration</CardTitle>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Manage Programs</Button>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-200">
                {["Program", "Status", "Staff", "Active Clients", "Req. Docs", "Compliance %", "Upcoming Reviews", "Risk"].map((header) => (
                  <th key={header} className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500 last:pr-0">{header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {programs.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-sm font-medium text-surface-900">No programs configured yet</td>
                </tr>
              ) : programs.map((program) => (
                <tr key={program.id}>
                  <td className="py-3 pr-4 font-medium text-surface-900">{program.name}</td>
                  <td className="py-3 pr-4"><StatusChip status={program.isActive ? "active" : "inactive"} size="sm" /></td>
                  <td className="py-3 pr-4 text-surface-700">—</td>
                  <td className="py-3 pr-4 text-surface-700">—</td>
                  <td className="py-3 pr-4 text-surface-700">—</td>
                  <td className="py-3 pr-4 text-surface-700">—</td>
                  <td className="py-3 pr-4 text-surface-700">—</td>
                  <td className="py-3 pr-4 text-surface-700 last:pr-0">—</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED} className="mt-4">+ Enable New Program</Button>
      </CardContent>
    </Card>
  )
}

function BrandingPreviewCard() {
  return (
    <Card id="branding-preview">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Branding Preview</CardTitle>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}>Preview PDF Output</Button>
      </CardHeader>
      <CardContent>
        <PDFViewerPlaceholder fileName="Branded document preview" height={420} />
        <div className="mt-4 flex flex-wrap items-center gap-4">
          <Checkbox label="Header" defaultChecked={false} disabled title={NOT_WIRED} />
          <Checkbox label="Footer" defaultChecked={false} disabled title={NOT_WIRED} />
          <Checkbox label="Watermark" defaultChecked={false} disabled title={NOT_WIRED} />
        </div>
        <Button variant="primary" size="sm" fullWidth disabled title={NOT_WIRED} className="mt-4">Edit Branding</Button>
      </CardContent>
    </Card>
  )
}
