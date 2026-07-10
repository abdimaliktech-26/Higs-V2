import Link from "next/link"
import { createValidationRule } from "@/lib/actions/validation"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { EmptyState } from "@/components/ui/states"
import { Scale, ExternalLink } from "lucide-react"
import type { getValidationRules } from "@/lib/actions/validation"
import { distinctValues } from "./rules-metrics"

type RuleRow = Awaited<ReturnType<typeof getValidationRules>>[number]

const severityVariant: Record<string, "danger" | "warning" | "secondary"> = { critical: "danger", warning: "warning", info: "secondary" }

interface Filters { category?: string; severity?: string; program?: string; packetType?: string; active?: string }

export function RulesLibraryCard({ allRules, filtered, filters, selectedRuleId }: { allRules: RuleRow[]; filtered: RuleRow[]; filters: Filters; selectedRuleId?: string }) {
  const categories = distinctValues(allRules, "category")
  const programs = distinctValues(allRules, "program")
  const packetTypes = distinctValues(allRules, "packetType")

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Rules Library ({filtered.length})</CardTitle>
        <Link href="/validation"><Button variant="secondary" size="sm"><ExternalLink className="h-4 w-4" /> Open Validation Center</Button></Link>
      </CardHeader>
      <CardContent className="space-y-6">
        <form className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <Select name="category" defaultValue={filters.category || ""} placeholder="All Categories" options={categories.map((c) => ({ value: c, label: c.replace(/_/g, " ") }))} />
          <Select name="severity" defaultValue={filters.severity || ""} placeholder="All Severities" options={[{ value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} />
          <Select name="program" defaultValue={filters.program || ""} placeholder="All Programs" options={programs.map((p) => ({ value: p, label: p }))} />
          <Select name="packetType" defaultValue={filters.packetType || ""} placeholder="All Packet Types" options={packetTypes.map((p) => ({ value: p, label: p.replace(/_/g, " ") }))} />
          <Select name="active" defaultValue={filters.active || ""} placeholder="All Statuses" options={[{ value: "true", label: "Active" }, { value: "false", label: "Inactive" }]} />
          <Button type="submit" size="sm" className="col-span-2 sm:col-span-1">Apply Filters</Button>
          <Link href="/compliance-rules-engine" className="flex items-center"><Button type="button" variant="ghost" size="sm">Clear</Button></Link>
        </form>

        {filtered.length === 0 ? (
          <EmptyState className="py-10" icon={<Scale className="h-6 w-6" />} title="No rules match these filters" description="Try clearing filters, or create a new rule below." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-200">
                  {["Name", "Category", "Severity", "Program", "Packet Type", "Status"].map((h) => (
                    <th key={h} className="pb-3 pr-4 text-left text-xs font-semibold uppercase tracking-wider text-surface-500 last:pr-0">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-100">
                {filtered.map((rule) => (
                  <tr key={rule.id} className={`hover:bg-surface-50 ${selectedRuleId === rule.id ? "bg-brand-50/60" : ""}`}>
                    <td className="py-3 pr-4">
                      <Link href={`/compliance-rules-engine?rule=${rule.id}`} className="font-medium text-surface-900 hover:text-brand-700 hover:underline">{rule.name}</Link>
                    </td>
                    <td className="py-3 pr-4 capitalize text-surface-600">{rule.category.replace(/_/g, " ")}</td>
                    <td className="py-3 pr-4"><Badge variant={severityVariant[rule.severity] || "secondary"} size="sm">{rule.severity}</Badge></td>
                    <td className="py-3 pr-4 text-surface-600">{rule.program || "—"}</td>
                    <td className="py-3 pr-4 capitalize text-surface-600">{rule.packetType?.replace(/_/g, " ") || "—"}</td>
                    <td className="py-3 pr-4 last:pr-0"><Badge variant={rule.active ? "success" : "secondary"} size="sm">{rule.active ? "Active" : "Inactive"}</Badge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <CreateRuleForm />
      </CardContent>
    </Card>
  )
}

function CreateRuleForm() {
  return (
    <div className="border-t border-surface-100 pt-5">
      <p className="mb-3 text-sm font-semibold text-surface-900">Create Rule</p>
      <form
        action={async (formData: FormData) => {
          "use server"
          await createValidationRule({
            name: formData.get("name") as string,
            description: (formData.get("description") as string) || undefined,
            category: formData.get("category") as string,
            severity: formData.get("severity") as string,
            program: (formData.get("program") as string) || undefined,
            packetType: (formData.get("packetType") as string) || undefined,
          })
        }}
        className="grid grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Input label="Rule Name" name="name" required />
        <Select label="Severity" name="severity" required options={[{ value: "critical", label: "Critical" }, { value: "warning", label: "Warning" }, { value: "info", label: "Info" }]} />
        <Input label="Category" name="category" required placeholder="e.g. required_field" />
        <Input label="Program" name="program" placeholder="Optional" />
        <Input label="Packet Type" name="packetType" placeholder="Optional" />
        <div className="sm:col-span-2">
          <Textarea label="Description" name="description" rows={2} />
        </div>
        <div className="sm:col-span-2">
          <Button type="submit" size="sm">Create Rule</Button>
        </div>
      </form>
    </div>
  )
}
