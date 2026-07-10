import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import {
  FileSpreadsheet, FileCog, FileArchive, FilesIcon, Sparkles, Copy, ScanText, Workflow,
  PlayCircle, ShieldCheck, RotateCcw, History, Cloud, CloudCog, Server, FileOutput, type LucideIcon,
} from "lucide-react"

interface Capability { icon: LucideIcon; title: string }

const capabilities: Capability[] = [
  { icon: FileSpreadsheet, title: "CSV Import" },
  { icon: FileCog, title: "Excel Import" },
  { icon: FileArchive, title: "ZIP Upload" },
  { icon: FilesIcon, title: "Bulk PDF Import" },
  { icon: Sparkles, title: "AI Field Mapping" },
  { icon: Copy, title: "Duplicate Detection" },
  { icon: ScanText, title: "OCR" },
  { icon: Workflow, title: "Migration Sessions" },
  { icon: PlayCircle, title: "Resume Migration" },
  { icon: ShieldCheck, title: "Validation Pipeline" },
  { icon: RotateCcw, title: "Rollback" },
  { icon: History, title: "Import History" },
  { icon: Cloud, title: "Google Drive" },
  { icon: CloudCog, title: "OneDrive" },
  { icon: Server, title: "Background Jobs" },
  { icon: FileOutput, title: "Export Report" },
]

export function FutureMigrationCapabilitiesGrid() {
  return (
    <Card>
      <CardHeader><CardTitle>Future Migration Capabilities</CardTitle></CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {capabilities.map((c) => (
            <div key={c.title} className="flex flex-col items-center gap-1.5 rounded-lg border border-surface-100 p-3 text-center opacity-60" title="Not part of this presentation pass — no backend source yet">
              <c.icon className="h-4 w-4 text-surface-400" />
              <span className="text-xs font-medium text-surface-600">{c.title}</span>
              <span className="rounded bg-surface-100 px-1.5 py-0.5 text-[10px] font-medium text-surface-500">Coming Soon</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
