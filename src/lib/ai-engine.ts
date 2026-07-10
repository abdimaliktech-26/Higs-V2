
export interface ExtractedField {
  name: string
  value: string
  confidence: number
  pageNumber: number
  fieldType: string
}

export interface AiSuggestion {
  type: "compliance" | "missing_data" | "inconsistency" | "recommendation"
  message: string
  confidence: number
  fieldName?: string
  documentId?: string
}

/**
 * AI Extraction Engine
 * 
 * Simulates AI-powered field extraction from documents.
 * In production, this would call an external AI/OCR service.
 * The extraction engine:
 *   1. Takes a document's field definitions
 *   2. Generates intelligent field suggestions
 *   3. Computes confidence scores
 *   4. Detects missing required fields
 *   5. Generates compliance recommendations
 */
export function runExtraction(fields: { name: string; fieldType: string; value: string | null; isRequired: boolean }[]): {
  extractedFields: ExtractedField[]
  overallConfidence: number
  suggestions: AiSuggestion[]
} {
  const extractedFields: ExtractedField[] = []
  const suggestions: AiSuggestion[] = []
  let totalConfidence = 0

  for (const field of fields) {
    const hasValue = !!field.value && field.value.trim().length > 0
    let confidence = 0.95

    // Simulate different confidence based on field type
    if (field.fieldType === "text" && hasValue) confidence = 0.92
    else if (field.fieldType === "date" && hasValue) confidence = 0.88
    else if (field.fieldType === "checkbox" && hasValue) confidence = 0.97
    else if (field.fieldType === "signature" && hasValue) confidence = 0.85
    else if (field.fieldType === "textarea" && hasValue) confidence = 0.90
    else confidence = 0

    // Simulate value extraction (in production, this would use OCR/AI)
    let value = field.value || ""
    if (!hasValue && field.fieldType === "date") {
      value = new Date().toISOString().split("T")[0]
      confidence = 0.45
    } else if (!hasValue && field.fieldType === "text") {
      value = `[AI: suggested value for ${field.name}]`
      confidence = 0.35
    }

    extractedFields.push({
      name: field.name,
      value,
      confidence: Math.round(confidence * 100) / 100,
      pageNumber: 1,
      fieldType: field.fieldType,
    })

    totalConfidence += confidence

    // Generate suggestions for empty fields
    if (!hasValue && field.isRequired) {
      suggestions.push({
        type: "missing_data",
        message: `Required field "${field.name}" has no value. AI suggests: "${value}"`,
        confidence,
        fieldName: field.name,
      })
    } else if (!hasValue) {
      suggestions.push({
        type: "recommendation",
        message: `Optional field "${field.name}" is empty. Consider adding if relevant.`,
        confidence: 0.6,
        fieldName: field.name,
      })
    }
  }

  const overallConfidence = fields.length > 0 ? Math.round((totalConfidence / fields.length) * 100) / 100 : 0

  // Generate compliance recommendations
  const emptyRequired = fields.filter(f => f.isRequired && (!f.value || f.value.trim() === ""))
  if (emptyRequired.length > 0) {
    suggestions.push({
      type: "compliance",
      message: `${emptyRequired.length} required field${emptyRequired.length > 1 ? "s" : ""} missing: ${emptyRequired.map(f => f.name).join(", ")}. Complete before submission.`,
      confidence: 0.98,
    })
  }

  // Date validation
  const dateFields = fields.filter(f => f.fieldType === "date" && f.value)
  for (const df of dateFields) {
    if (df.value && isNaN(Date.parse(df.value))) {
      suggestions.push({
        type: "inconsistency",
        message: `Date field "${df.name}" contains an invalid date format.`,
        confidence: 0.95,
        fieldName: df.name,
      })
    }
  }

  return { extractedFields, overallConfidence, suggestions }
}

export function generatePacketRecommendations(
  packet: { status: string; dueDate: Date | null },
  documents: { status: string; isRequired: boolean; name: string }[],
  validations: { score: number; criticalCount: number }[],
  signatures: { status: string }[],
): AiSuggestion[] {
  const suggestions: AiSuggestion[] = []

  // Overdue check
  if (packet.dueDate && new Date(packet.dueDate) < new Date() && packet.status !== "approved" && packet.status !== "archived") {
    suggestions.push({
      type: "compliance",
      message: `Packet is overdue (due ${packet.dueDate.toLocaleDateString()}). Prioritize completion to maintain compliance.`,
      confidence: 0.99,
    })
  }

  // Incomplete documents
  const incompleteRequired = documents.filter(d => d.isRequired && d.status !== "completed")
  if (incompleteRequired.length > 0) {
    suggestions.push({
      type: "missing_data",
      message: `${incompleteRequired.length} required document${incompleteRequired.length > 1 ? "s" : ""} not yet completed: ${incompleteRequired.map(d => d.name).join(", ")}.`,
      confidence: 0.95,
    })
  }

  // Validation trends
  if (validations.length > 0) {
    const lastValidation = validations[0]
    if (lastValidation.criticalCount > 0) {
      suggestions.push({
        type: "compliance",
        message: `Last validation found ${lastValidation.criticalCount} critical issue${lastValidation.criticalCount > 1 ? "s" : ""}. Resolve before submitting for approval.`,
        confidence: 0.97,
      })
    }
  }

  // Signature readiness
  const pendingSigs = signatures.filter(s => s.status === "pending" || s.status === "sent")
  if (pendingSigs.length > 0) {
    suggestions.push({
      type: "recommendation",
      message: `${pendingSigs.length} signature${pendingSigs.length > 1 ? "s" : ""} pending. Follow up with signers to complete the workflow.`,
      confidence: 0.88,
    })
  }

  return suggestions
}
