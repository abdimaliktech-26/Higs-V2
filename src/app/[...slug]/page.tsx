import { Metadata } from "next"
import { SessionProvider } from "@/components/providers/session-provider"
import { AppShellContent } from "@/components/layout/app-shell"
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { FolderOpen, Shield, PenSquare, CheckSquare, Search, BarChart, Library, FileText, GraduationCap, BrainCircuit, Puzzle, Zap, Gauge } from "lucide-react"

const pageConfig: Record<string, { title: string; description: string; icon: React.ReactNode; phase: string }> = {
  packets: { title: "Packets", description: "Manage client compliance packets", icon: <FolderOpen className="h-8 w-8" />, phase: "Phase 4" },
  documents: { title: "Documents", description: "Working document area", icon: <FileText className="h-8 w-8" />, phase: "Phase 4" },
  "pdf-editor": { title: "PDF Editor", description: "Open, edit, and review client PDFs", icon: <FileText className="h-8 w-8" />, phase: "Phase 5" },
  validation: { title: "Validation Center", description: "Compliance validation results", icon: <Shield className="h-8 w-8" />, phase: "Phase 6" },
  signatures: { title: "Signature Workflow", description: "Signature requests and status", icon: <PenSquare className="h-8 w-8" />, phase: "Phase 6" },
  approvals: { title: "Approval Center", description: "Manager approval and finalization", icon: <CheckSquare className="h-8 w-8" />, phase: "Phase 6" },
  audit: { title: "Audit Center", description: "Audit readiness and evidence", icon: <Search className="h-8 w-8" />, phase: "Phase 7" },
  reports: { title: "Reports", description: "Compliance and operational reports", icon: <BarChart className="h-8 w-8" />, phase: "Phase 7" },
  library: { title: "Document Library", description: "Stored templates and completed PDFs", icon: <Library className="h-8 w-8" />, phase: "Phase 7" },
  templates: { title: "Templates & Forms Manager", description: "Upload and manage DHS PDF templates", icon: <FileText className="h-8 w-8" />, phase: "Phase 3" },
  "settings-org": { title: "Organization Settings", description: "Manage organization configuration", icon: <FolderOpen className="h-8 w-8" />, phase: "Phase 1" },
  "settings-users": { title: "User Management", description: "Manage organization users and roles", icon: <FolderOpen className="h-8 w-8" />, phase: "Phase 9" },
  "settings-profile": { title: "Profile & Account", description: "Manage your personal settings", icon: <FolderOpen className="h-8 w-8" />, phase: "Phase 1" },
  help: { title: "Help Center", description: "Documentation and support", icon: <FolderOpen className="h-8 w-8" />, phase: "Phase 13" },
  training: { title: "Training & Certification Center", description: "Staff training and certification tracking", icon: <GraduationCap className="h-8 w-8" />, phase: "Phase 9" },
  "ai-copilot": { title: "AI Compliance Copilot", description: "AI-powered compliance assistance", icon: <BrainCircuit className="h-8 w-8" />, phase: "Phase 8" },
  integrations: { title: "Integrations Marketplace", description: "Enterprise system connections", icon: <Puzzle className="h-8 w-8" />, phase: "Phase 9" },
  automation: { title: "AI Automation Studio", description: "No-code workflow automation", icon: <Zap className="h-8 w-8" />, phase: "Phase 9" },
  "command-center": { title: "Executive Command Center", description: "Leadership analytics and oversight", icon: <Gauge className="h-8 w-8" />, phase: "Phase 9" },
}

interface Props {
  params: Promise<{ slug: string[] }>
}

function getConfig(slug: string[]) {
  const key = slug.join("-")
  return pageConfig[key]
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug
  const config = getConfig(slug)
  return { title: config ? `${config.title} - Higsi V2` : "Higsi V2" }
}

export default async function DynamicStubPage({ params }: Props) {
  const slug = (await params).slug
  const config = getConfig(slug)

  if (!config) {
    return (
      <SessionProvider>
        <AppShellContent>
          <Card>
            <CardContent>
              <EmptyState title="Page not found" description="The requested page does not exist" />
            </CardContent>
          </Card>
        </AppShellContent>
      </SessionProvider>
    )
  }

  return (
    <SessionProvider>
      <AppShellContent>
        <Card>
          <CardHeader>
            <CardTitle>{config.title}</CardTitle>
            <CardDescription>{config.description}</CardDescription>
          </CardHeader>
          <CardContent>
            <EmptyState
              title={config.title}
              description={`This module is coming in ${config.phase}. The foundation is ready for it.`}
              icon={config.icon}
            />
          </CardContent>
        </Card>
      </AppShellContent>
    </SessionProvider>
  )
}
