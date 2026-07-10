export interface AuditCategory {
  label: string
  actions: string[]
}

// Single source of truth for both the log filter dropdown and the dashboard's
// per-category activity counts above it.
export const auditCategories: Record<string, AuditCategory> = {
  clients: {
    label: "Clients",
    actions: ["CLIENT_VIEWED", "CLIENT_CREATED", "CLIENT_UPDATED", "CLIENT_ARCHIVED", "CONTACT_ADDED", "CONTACT_UPDATED", "CONTACT_REMOVED"],
  },
  documents: {
    label: "Documents",
    actions: [
      "DOCUMENT_VIEWED", "DOCUMENT_EDITED", "DOCUMENT_SAVED", "DOCUMENT_FIELD_ADDED", "DOCUMENT_FIELD_UPDATED",
      "PDF_VERSION_CREATED", "DOCUMENT_COMMENT_ADDED", "TEMPLATE_UPLOADED", "TEMPLATE_ACTIVATED", "TEMPLATE_RETIRED",
      "DOCUMENT_LOCKED", "DOCUMENT_UPLOADED", "DOCUMENT_ARCHIVED", "DOCUMENT_DOWNLOADED",
    ],
  },
  packets: {
    label: "Packets",
    actions: ["PACKET_VIEWED", "PACKET_CREATED", "PACKET_STATUS_CHANGED", "PACKET_DOCUMENT_STATUS_CHANGED", "PACKET_TEMPLATE_CREATED"],
  },
  validation: {
    label: "Validation",
    actions: ["VALIDATION_RUN", "VALIDATION_ISSUE_CREATED", "VALIDATION_ISSUE_RESOLVED", "COMPLIANCE_SCORE_UPDATED"],
  },
  signatures: {
    label: "Signatures",
    actions: ["SIGNATURE_REQUESTED", "SIGNATURE_SENT", "SIGNATURE_VIEWED", "SIGNATURE_COMPLETED", "SIGNATURE_DECLINED", "SIGNATURE_CANCELLED"],
  },
  approvals: {
    label: "Approvals",
    actions: ["APPROVAL_SUBMITTED", "APPROVAL_APPROVED", "APPROVAL_REJECTED", "APPROVAL_CHANGES_REQUESTED", "APPROVAL_CANCELLED"],
  },
  security: {
    label: "Users & Security",
    actions: ["LOGIN", "LOGOUT", "ORGANIZATION_SWITCH", "USER_CREATED", "USER_UPDATED", "ROLE_CHANGED", "MEMBER_CREATED", "MEMBER_UPDATED", "STAFF_ASSIGNED", "STAFF_UNASSIGNED", "ACCESS_DENIED"],
  },
  ai: {
    label: "AI",
    actions: ["AI_EXTRACTION_RUN", "AI_RECOMMENDATION_GENERATED", "AI_RECOMMENDATION_APPLIED"],
  },
}

export const severityMap: Record<string, "info" | "warning" | "success" | "danger" | "default"> = {
  LOGIN: "info", LOGOUT: "info",
  CLIENT_CREATED: "success", CLIENT_UPDATED: "info", CLIENT_ARCHIVED: "warning", CLIENT_VIEWED: "default",
  APPROVAL_APPROVED: "success", APPROVAL_REJECTED: "danger", APPROVAL_CANCELLED: "warning",
  VALIDATION_RUN: "default", VALIDATION_ISSUE_CREATED: "warning", VALIDATION_ISSUE_RESOLVED: "success",
  SIGNATURE_COMPLETED: "success", SIGNATURE_DECLINED: "danger", SIGNATURE_CANCELLED: "warning",
  DOCUMENT_EDITED: "info", DOCUMENT_SAVED: "info",
  ACCESS_DENIED: "danger",
}

// Actions treated as "high-risk / compliance-relevant" on the dashboard: failures, denials, and rejections.
export const HIGH_RISK_ACTIONS = ["ACCESS_DENIED", "APPROVAL_REJECTED", "SIGNATURE_DECLINED", "VALIDATION_ISSUE_CREATED"]

// Actions that represent access to a client's protected health information.
export const PHI_ACCESS_ACTIONS = ["CLIENT_VIEWED", "DOCUMENT_VIEWED", "PACKET_VIEWED"]

// Where an audit event's target can be opened directly.
export function targetHref(targetType: string | null, targetId: string | null): string | null {
  if (!targetType || !targetId) return null
  switch (targetType) {
    case "client": return `/clients/${targetId}`
    case "packet": return `/packets/${targetId}`
    case "document":
    case "packet_document": return `/documents/${targetId}/edit`
    case "signature_request": return `/signatures/${targetId}`
    case "approval_request": return `/approvals/${targetId}`
    default: return null
  }
}
