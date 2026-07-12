// Stage 5 Step 4a: Conditional Logic Foundation — shared types.
// Pure data shapes only, no Prisma imports here.

export type ConditionSourceType = "TEMPLATE_FIELD" | "CLIENT_IS_MINOR" | "PACKET_PROGRAM_CODE" | "PACKET_TYPE"

export type ConditionOperator =
  | "EQUALS"
  | "NOT_EQUALS"
  | "CONTAINS"
  | "NOT_EMPTY"
  | "EMPTY"
  | "CHECKED"
  | "UNCHECKED"
  | "GREATER_THAN"
  | "LESS_THAN"
  | "BEFORE"
  | "AFTER"
  | "IN"
  | "NOT_IN"

export type ConditionLogicOperator = "AND" | "OR"

export type TemplateFieldType = "text" | "date" | "checkbox" | "signature" | "textarea" | "select"

export interface EvaluationCondition {
  sourceType: ConditionSourceType
  sourceFieldKey: string | null
  // Step 4b — set only on document-owned (DOCUMENT_INCLUSION/DOCUMENT_REQUIREDNESS)
  // TEMPLATE_FIELD conditions, pointing at the PacketTemplateDocument.id the
  // field lives on (the owner mapping itself, or a sibling in the same
  // PacketTemplate). Always null for field-owned conditions, which resolve
  // from `fieldValues` exactly as in Step 4a.
  sourcePacketTemplateDocumentId: string | null
  operator: ConditionOperator
  comparisonValue: unknown
}

export interface EvaluationGroup {
  logicOperator: ConditionLogicOperator
  conditions: EvaluationCondition[]
  childGroups: EvaluationGroup[]
}

export interface ClientContext {
  isMinor: boolean
}

export interface PacketContext {
  programCode: string | null
  packetType: string
}

export interface EvaluationContext {
  fieldValues: Record<string, unknown>
  client: ClientContext
  packet: PacketContext
  // Step 4b — cross-document field values for document-owned conditions.
  // First key: PacketTemplateDocument.id. Second key: fieldKey on that
  // mapping's document. Optional and defaults to empty — Step 4a callers
  // (field-owned, same-document conditions) never need to supply this.
  documentFieldValues?: Record<string, Record<string, unknown>>
}

export interface ConditionEvaluationDetail {
  sourceType: ConditionSourceType
  sourceFieldKey: string | null
  sourcePacketTemplateDocumentId: string | null
  operator: ConditionOperator
  resolvedValue: unknown
  comparisonValue: unknown
  result: boolean
}

export interface GroupEvaluationDetail {
  logicOperator: ConditionLogicOperator
  result: boolean
  conditions: ConditionEvaluationDetail[]
  childGroups: GroupEvaluationDetail[]
}

export interface EvaluationResult {
  result: boolean
  detail: GroupEvaluationDetail
}
