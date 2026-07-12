import type { EvaluationGroup, GroupEvaluationDetail } from "./types"

export const CONDITION_RUNTIME_VERSION = 1

export interface SnapshotGroup extends EvaluationGroup {
  id: string
  purpose: "FIELD_VISIBILITY" | "FIELD_REQUIREDNESS" | "DOCUMENT_INCLUSION" | "DOCUMENT_REQUIREDNESS"
}

export interface SnapshotField {
  id: string
  fieldKey: string
  fieldType: string
  isRequired: boolean
  conditionGroups: SnapshotGroup[]
}

export interface SnapshotMapping {
  id: string
  documentTemplateId: string
  required: boolean
  sortOrder: number
  conditionGroups: SnapshotGroup[]
  fields: SnapshotField[]
}

export interface PacketConditionDefinition {
  schemaVersion: 1
  packetTemplateId: string
  mappings: SnapshotMapping[]
}

export interface RuntimeIntegrityError {
  type: string
  message: string
  mappingId?: string
  packetDocumentId?: string
  fieldId?: string
}

export interface RuntimePacketDocument {
  id: string
  mappingId: string
  documentTemplateId: string
  staticRequired: boolean
  applicabilityStatus: "ACTIVE" | "CONDITIONALLY_INACTIVE"
  fieldsById: Record<string, RuntimePdfField>
  fieldValues: Record<string, unknown>
}

export interface RuntimePdfField {
  id: string
  templateFieldKey: string | null
  documentTemplateFieldId: string | null
  value: string | null
  staticRequired: boolean
}

// Direct, mode-independent lookups by the row's own database id — the only
// stable identity a legacy PacketDocument/PdfField has (legacy rows carry no
// mapping id). Populated for both legacy and snapshot packets; legacy
// requiredness evaluation reads exclusively from these, never inferring
// through packetDocumentsByMappingId (which is empty for legacy packets).
export interface RuntimePacketDocumentIndexEntry {
  id: string
  isRequired: boolean
  applicabilityStatus: "ACTIVE" | "CONDITIONALLY_INACTIVE"
  packetTemplateDocumentId: string | null
}

export interface RuntimePdfFieldIndexEntry {
  id: string
  packetDocumentId: string
  isRequired: boolean
  templateFieldKey: string | null
}

export interface PacketConditionRuntime {
  mode: "legacy" | "snapshot"
  packetId: string
  organizationId: string
  packetCreatedAt: Date
  packetType: string
  programCode: string | null
  client: { isMinor: boolean | null }
  snapshotId: string | null
  runtimeVersion: number | null
  definition: PacketConditionDefinition | null
  packetDocumentsByMappingId: Record<string, RuntimePacketDocument>
  packetDocumentsById: Record<string, RuntimePacketDocumentIndexEntry>
  pdfFieldsById: Record<string, RuntimePdfFieldIndexEntry>
  documentFieldValues: Record<string, Record<string, unknown>>
  integrityErrors: RuntimeIntegrityError[]
}

export type RuntimeEvaluation =
  | { status: "evaluated"; result: boolean; knownEmptyInputs: string[]; detail: GroupEvaluationDetail | null }
  | { status: "integrity_error"; errors: RuntimeIntegrityError[] }

