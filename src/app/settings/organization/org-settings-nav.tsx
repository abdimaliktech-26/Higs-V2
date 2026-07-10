import Link from "next/link"

export interface OrgSettingsTabDef { id: string; label: string }

export const orgSettingsTabs: OrgSettingsTabDef[] = [
  { id: "profile", label: "Organization Profile" },
  { id: "branding", label: "Branding" },
  { id: "locations", label: "Locations" },
  { id: "departments", label: "Departments" },
  { id: "programs", label: "Programs" },
  { id: "security", label: "Security" },
  { id: "authentication", label: "Authentication" },
  { id: "roles", label: "Roles & Permissions" },
  { id: "notifications", label: "Notifications" },
  { id: "documents", label: "Document Settings" },
  { id: "pdf", label: "PDF Editor Defaults" },
  { id: "more", label: "More" },
]

export function OrgSettingsNav({ active }: { active: string }) {
  return (
    <div className="flex flex-wrap gap-1 rounded-xl border border-surface-200 bg-white p-1.5">
      {orgSettingsTabs.map((tab) => (
        <Link
          key={tab.id}
          href={`/settings/organization?tab=${tab.id}`}
          className={
            active === tab.id
              ? "rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-lg px-3 py-1.5 text-sm font-medium text-surface-500 hover:bg-surface-50 hover:text-surface-700"
          }
        >
          {tab.label}
        </Link>
      ))}
    </div>
  )
}
