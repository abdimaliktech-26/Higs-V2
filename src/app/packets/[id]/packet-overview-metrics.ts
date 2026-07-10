export interface PacketDocLike {
  id: string
  status: string
  isRequired: boolean
  documentTemplate: { name: string }
}

export interface ValidationLike {
  score: number
  criticalCount: number
  warningCount: number
}

export interface SignatureLike {
  status: string
  signerName: string
}

export interface ApprovalLike {
  status: string
}

export interface ReadinessBreakdown {
  pendingSignatures: number
  validationErrors: number
  incompleteDocuments: number
  pendingApproval: number
}

export interface Readiness {
  pct: number
  breakdown: ReadinessBreakdown
  tone: "success" | "warning" | "danger"
}

/**
 * Presentation-only rollup — NOT an official compliance score. Simple
 * average of four real percentages already available on this page:
 * required-document completion, signature completion, the most recent
 * validation score, and approval status. Documented here so it's never
 * mistaken for a stored/authoritative metric.
 */
export function deriveReadiness(docs: PacketDocLike[], validation: ValidationLike | null, signatures: SignatureLike[], approval: ApprovalLike | null): Readiness {
  const requiredDocs = docs.filter((d) => d.isRequired)
  const completedRequiredDocs = requiredDocs.filter((d) => d.status === "completed")
  const docsPct = requiredDocs.length > 0 ? Math.round((completedRequiredDocs.length / requiredDocs.length) * 100) : 100

  const pendingSignatures = signatures.filter((s) => ["pending", "sent", "viewed"].includes(s.status)).length
  const signaturesPct = signatures.length > 0 ? Math.round(((signatures.length - pendingSignatures) / signatures.length) * 100) : 100

  const validationPct = validation ? validation.score : 100
  const validationErrors = validation?.criticalCount ?? 0

  const pendingApproval = approval?.status === "pending" ? 1 : 0
  const approvalPct = approval?.status === "approved" ? 100 : approval?.status === "pending" ? 50 : approval ? 0 : 100

  const pct = Math.round((docsPct + signaturesPct + validationPct + approvalPct) / 4)
  const tone: Readiness["tone"] = pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger"

  return {
    pct,
    tone,
    breakdown: {
      pendingSignatures,
      validationErrors,
      incompleteDocuments: requiredDocs.length - completedRequiredDocs.length,
      pendingApproval,
    },
  }
}

export type PriorityKind = "validation" | "document" | "signature" | "approval_ready" | "ready"

export interface PriorityItem {
  kind: PriorityKind
  title: string
  description: string
  ctaLabel: string
  ctaHref: string
}

/**
 * Deterministic, factual "what to do next" derivation — no AI, no
 * invented reasoning. Priority order: validation errors, then an
 * incomplete required document, then a pending signature, then
 * (if everything else is done) suggesting the next real workflow step.
 */
export function derivePriorityItem(
  packetId: string,
  docs: PacketDocLike[],
  validation: (ValidationLike & { id: string }) | null,
  signatures: SignatureLike[],
  approval: ApprovalLike | null,
): PriorityItem {
  if (validation && validation.criticalCount > 0) {
    return {
      kind: "validation",
      title: "Resolve validation errors",
      description: `${validation.criticalCount} critical validation issue${validation.criticalCount !== 1 ? "s" : ""} must be resolved before this packet can proceed.`,
      ctaLabel: "Review Validation Issues",
      ctaHref: `/validation/${validation.id}`,
    }
  }

  const incompleteRequired = docs.find((d) => d.isRequired && d.status !== "completed")
  if (incompleteRequired) {
    return {
      kind: "document",
      title: incompleteRequired.documentTemplate.name,
      description: `This required document is ${incompleteRequired.status.replace(/_/g, " ")} and must be completed before the packet is ready.`,
      ctaLabel: "Continue Editing",
      ctaHref: `/documents/${incompleteRequired.id}/edit`,
    }
  }

  const pendingSignature = signatures.find((s) => ["pending", "sent", "viewed"].includes(s.status))
  if (pendingSignature) {
    return {
      kind: "signature",
      title: "Signature pending",
      description: `Waiting on a signature from ${pendingSignature.signerName}.`,
      ctaLabel: "View Signatures",
      ctaHref: `/signatures?packetId=${packetId}`,
    }
  }

  if (!approval || approval.status === "changes_requested" || approval.status === "rejected") {
    return {
      kind: "approval_ready",
      title: "Ready to submit for approval",
      description: "All required documents are complete and there are no pending signatures or validation errors.",
      ctaLabel: "Submit for Approval",
      ctaHref: `/packets/${packetId}`,
    }
  }

  return {
    kind: "ready",
    title: "Packet is on track",
    description: approval.status === "approved" ? "This packet has been approved." : "Awaiting approval decision — no action needed right now.",
    ctaLabel: "View Packet",
    ctaHref: `/packets/${packetId}`,
  }
}
