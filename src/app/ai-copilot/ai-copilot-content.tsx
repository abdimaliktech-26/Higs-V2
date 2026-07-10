import Link from "next/link"
import { getAiExtractions, getAiRecommendations } from "@/lib/actions/ai"
import { getAuditDashboardSummary } from "@/lib/actions/audit"
import { getUpcomingDeadlines } from "@/app/notifications/notifications-data"
import { deriveAiCopilotKpis } from "./ai-copilot-metrics"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState } from "@/components/ui/states"
import { Sparkles, UploadCloud, FileBarChart, Settings2, MoreHorizontal } from "lucide-react"
import { AiCopilotKpiRow } from "./ai-copilot-kpi-row"
import { AiAgentsCard, ConversationHistoryCard, SuggestedPromptsCard } from "./ai-copilot-agents-sidebar"
import { AiChatPromptCard } from "./ai-copilot-chat-workspace"
import { ValidationAnalysisCard } from "./ai-copilot-validation-card"
import { DocumentIntelligencePanel } from "./ai-copilot-document-intelligence"
import { HigsiAiInsightsCard, AuditReadinessSnapshotCard, AiCopilotQuickActionsCard, KnowledgeBaseCard } from "./ai-copilot-insights-sidebar"
import { AuditReadinessOverviewCard, ComplianceRiskHeatmapCard, UpcomingDeadlinesCard, WorkloadOverviewCard } from "./ai-copilot-bottom"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

interface Props { orgId: string }

export async function AiCopilotContent({ orgId }: Props) {
  let extractions: Awaited<ReturnType<typeof getAiExtractions>>
  let recommendations: Awaited<ReturnType<typeof getAiRecommendations>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let upcomingDeadlines: Awaited<ReturnType<typeof getUpcomingDeadlines>>

  try {
    [extractions, recommendations, auditSummary, upcomingDeadlines] = await Promise.all([
      getAiExtractions(orgId),
      getAiRecommendations(orgId),
      getAuditDashboardSummary(orgId),
      getUpcomingDeadlines(orgId),
    ])
  } catch (e) {
    return <ErrorState title="Error" description={(e as Error).message} />
  }

  const openRecs = recommendations.filter((r) => r.status === "open")
  const kpis = deriveAiCopilotKpis(extractions.extractions, extractions.total, recommendations, auditSummary.auditReadinessScore)
  const latestExtraction = extractions.extractions[0] || null

  return (
    <div className="space-y-6">
      <PageHeader />

      <AiCopilotKpiRow kpis={kpis} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,2fr)_minmax(0,5fr)_minmax(0,2.3fr)]">
        <div className="space-y-6">
          <AiAgentsCard />
          <ConversationHistoryCard />
          <SuggestedPromptsCard />
        </div>

        <div className="space-y-6">
          <AiChatPromptCard />
          <ValidationAnalysisCard recommendations={recommendations} />
          <DocumentIntelligencePanel extraction={latestExtraction} />
        </div>

        <div className="space-y-6">
          <HigsiAiInsightsCard recommendations={openRecs} />
          <AuditReadinessSnapshotCard score={auditSummary.auditReadinessScore} packetsTotal={auditSummary.packetsTotal} evidenceReadyPackets={auditSummary.evidenceReadyPackets} />
          <AiCopilotQuickActionsCard />
          <KnowledgeBaseCard />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 xl:grid-cols-4">
        <AuditReadinessOverviewCard score={auditSummary.auditReadinessScore} />
        <ComplianceRiskHeatmapCard />
        <UpcomingDeadlinesCard deadlines={upcomingDeadlines} />
        <WorkloadOverviewCard />
      </div>
    </div>
  )
}

function PageHeader() {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex items-center gap-2">
          <h1 className="text-2xl font-bold text-surface-900 tracking-tight">AI Compliance Copilot</h1>
          <Badge variant="info" size="sm">Enterprise</Badge>
        </div>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">Ask questions, investigate compliance, generate reports, and receive AI-powered operational guidance.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><Sparkles className="h-4 w-4" /> New Analysis</Button>
        <Link href="/library?tab=supporting#upload"><Button variant="secondary" size="sm"><UploadCloud className="h-4 w-4" /> Upload Document</Button></Link>
        <Link href="/reports"><Button variant="secondary" size="sm"><FileBarChart className="h-4 w-4" /> Generate Report</Button></Link>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Settings2 className="h-4 w-4" /> AI Settings</Button>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[
            { value: "export", label: "Export Conversation", disabled: true },
            { value: "share", label: "Share Analysis", disabled: true },
          ]}
        />
      </div>
    </div>
  )
}
