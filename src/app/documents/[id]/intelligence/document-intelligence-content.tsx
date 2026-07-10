import Link from "next/link"
import { getEditableDocument } from "@/lib/actions/documents"
import { getAiExtractions, getAiRecommendations } from "@/lib/actions/ai"
import { getValidationResults, getValidationResultDetail } from "@/lib/actions/validation"
import { deriveCompleteness, partitionIssues, buildSummaryLine } from "./di-metrics"
import { Button } from "@/components/ui/button"
import { Dropdown } from "@/components/ui/dropdown"
import { ErrorState, AccessDeniedState } from "@/components/ui/states"
import { UploadCloud, Layers, Download, History, MoreHorizontal } from "lucide-react"
import { DocumentInformationCard, ClientInformationCard, PacketInformationCard } from "./di-info-panels"
import { DocumentPreviewCard } from "./di-preview"
import { AiExtractionResultsCard } from "./di-extraction-results"
import { IssuesDetectedCard, MissingInformationCard, WarningsCard, NoValidationYetCard } from "./di-issues"
import { AiSummaryCard, AiRecommendationsCard } from "./di-ai-panel"
import { DocumentHistoryCard } from "./di-history"
import { ReviewActionFooter } from "./di-footer"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export async function DocumentIntelligenceContent({ documentId }: { documentId: string }) {
  let doc: Awaited<ReturnType<typeof getEditableDocument>>
  try {
    doc = await getEditableDocument(documentId)
  } catch (e) {
    const message = (e as Error).message
    if (message.includes("Access denied")) return <AccessDeniedState description={message} />
    return <ErrorState title="Error loading document" description={message} />
  }

  const orgId = doc.packet.organizationId

  const [extractionsRes, recommendations, validationList] = await Promise.all([
    getAiExtractions(orgId, { documentId }),
    getAiRecommendations(orgId, { packetId: doc.packetId }),
    getValidationResults(orgId, { packetId: doc.packetId, pageSize: 1 }),
  ])

  const latestResultId = validationList.results[0]?.id
  const validationDetail = latestResultId ? await getValidationResultDetail(latestResultId) : null
  const partitioned = validationDetail ? partitionIssues(validationDetail.issues) : null

  const completeness = deriveCompleteness(doc.fields)
  const docRecommendations = recommendations.filter((r) => r.packetDocumentId === documentId || !r.packetDocumentId)
  const openIssueCount = partitioned ? partitioned.issues.length + partitioned.missingInformation.length + partitioned.warnings.length : 0
  const summary = buildSummaryLine(completeness, openIssueCount)
  const latestExtraction = extractionsRes.extractions[0] || null

  return (
    <div className="space-y-6">
      <PageHeader documentName={doc.documentTemplate.name} documentId={documentId} />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <DocumentInformationCard
          documentName={doc.documentTemplate.name}
          documentType={doc.documentTemplate.formType}
          packetType={doc.packet.packetType}
          status={doc.status}
          currentVersion={doc.currentVersion}
          addedAt={doc.createdAt}
        />
        <ClientInformationCard
          clientId={doc.packet.client.id}
          clientName={`${doc.packet.client.firstName} ${doc.packet.client.lastName}`}
          mcadId={doc.packet.client.mcadId}
          caseManagerName={doc.packet.assignedTo?.name ?? null}
        />
        <PacketInformationCard
          packetId={doc.packetId}
          programName={doc.packet.program?.name ?? null}
          status={doc.packet.status}
          dueDate={doc.packet.dueDate}
          assignedToName={doc.packet.assignedTo?.name ?? null}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <DocumentPreviewCard pdfUrl={doc.pdfUrl} />
        <AiExtractionResultsCard
          extraction={latestExtraction}
          classification={doc.documentTemplate.name}
          packetType={doc.packet.packetType}
          programName={doc.packet.program?.name ?? null}
          formVersion={doc.documentTemplate.version}
          completeness={completeness}
        />
      </div>

      <AiSummaryCard summary={summary} />

      {partitioned ? (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <IssuesDetectedCard issues={partitioned.issues} />
          <MissingInformationCard items={partitioned.missingInformation} />
          <WarningsCard warnings={partitioned.warnings} />
        </div>
      ) : (
        <NoValidationYetCard />
      )}

      <AiRecommendationsCard recommendations={docRecommendations} />

      <DocumentHistoryCard versions={doc.versions} />

      <ReviewActionFooter documentId={documentId} />
    </div>
  )
}

function PageHeader({ documentName, documentId }: { documentName: string; documentId: string }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <p className="text-xs font-medium text-surface-400">AI Suite / AI Document Intelligence Studio</p>
        <h1 className="mt-1 text-2xl font-bold text-surface-900 tracking-tight">{documentName}</h1>
        <p className="mt-1 max-w-2xl text-sm text-surface-500">Intelligent document processing, classification, extraction, and validation.</p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Link href="/library"><Button variant="secondary" size="sm"><UploadCloud className="h-4 w-4" /> Upload Document</Button></Link>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Layers className="h-4 w-4" /> Batch Processing</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Download className="h-4 w-4" /> Export Results</Button>
        <a href="#history"><Button variant="secondary" size="sm"><History className="h-4 w-4" /> Document History</Button></a>
        <Dropdown
          trigger={<Button variant="ghost" size="icon-sm" type="button"><MoreHorizontal className="h-4 w-4" /></Button>}
          options={[{ value: "document", label: `Document: ${documentId.slice(0, 8)}…`, disabled: true }]}
        />
      </div>
    </div>
  )
}
