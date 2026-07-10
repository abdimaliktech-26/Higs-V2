import type { getPackets } from "@/lib/actions/templates"
import type { getSignatureRequests } from "@/lib/actions/signatures"
import type { getApprovalRequests } from "@/lib/actions/approvals"
import type { getValidationResults } from "@/lib/actions/validation"

type PacketRow = Awaited<ReturnType<typeof getPackets>>["packets"][number]
type SignatureRow = Awaited<ReturnType<typeof getSignatureRequests>>["requests"][number]
type ApprovalRow = Awaited<ReturnType<typeof getApprovalRequests>>["requests"][number]
type ValidationRow = Awaited<ReturnType<typeof getValidationResults>>["results"][number]

export type WorkItemSource = "packet" | "signature" | "approval" | "validation"
export type WorkItemPriority = "high" | "medium" | "normal"

export interface WorkItem {
  id: string
  source: WorkItemSource
  priority: WorkItemPriority
  title: string
  clientName: string | null
  packetId: string | null
  packetType: string | null
  assignedToName: string | null
  assignedToId: string | null
  dueDate: Date | null
  status: string
  lastUpdated: Date
  href: string
}

const TERMINAL_STATUSES = ["approved", "archived", "completed", "signed", "declined", "rejected"]

function isOverdue(dueDate: Date | null, status: string): boolean {
  return !!dueDate && new Date(dueDate) < new Date() && !TERMINAL_STATUSES.includes(status)
}

function isDueSoon(dueDate: Date | null, status: string): boolean {
  if (!dueDate || TERMINAL_STATUSES.includes(status)) return false
  const days = (new Date(dueDate).getTime() - Date.now()) / 86400000
  return days >= 0 && days <= 7
}

/**
 * Derives a simple, honest priority bucket from real due-date and status
 * data already on each row — the same threshold logic already used
 * elsewhere in the app (overdue detection in generateNotifications,
 * readinessLabel bucketing). Not a new scoring engine.
 */
function priorityFor(dueDate: Date | null, status: string, critical = false): WorkItemPriority {
  if (critical || isOverdue(dueDate, status)) return "high"
  if (isDueSoon(dueDate, status)) return "medium"
  return "normal"
}

export function fromPackets(packets: PacketRow[]): WorkItem[] {
  return packets.map((p) => ({
    id: `packet:${p.id}`,
    source: "packet",
    priority: priorityFor(p.dueDate, p.status),
    title: `${p.packetType.replace(/_/g, " ")} packet`,
    clientName: `${p.client.firstName} ${p.client.lastName}`,
    packetId: p.id,
    packetType: p.packetType,
    assignedToName: p.assignedTo?.name ?? null,
    assignedToId: p.assignedToId,
    dueDate: p.dueDate,
    status: p.status,
    lastUpdated: p.updatedAt,
    href: `/packets/${p.id}`,
  }))
}

export function fromSignatures(requests: SignatureRow[]): WorkItem[] {
  return requests.map((r) => ({
    id: `signature:${r.id}`,
    source: "signature",
    priority: priorityFor(r.dueDate, r.status),
    title: `Signature needed — ${r.signerName}`,
    clientName: r.packet ? `${r.packet.client.firstName} ${r.packet.client.lastName}` : null,
    packetId: r.packetId,
    packetType: r.packet?.packetType ?? null,
    assignedToName: null,
    assignedToId: null,
    dueDate: r.dueDate,
    status: r.status,
    lastUpdated: r.updatedAt,
    href: `/signatures/${r.id}`,
  }))
}

export function fromApprovals(requests: ApprovalRow[]): WorkItem[] {
  return requests.map((r) => ({
    id: `approval:${r.id}`,
    source: "approval",
    priority: priorityFor(null, r.status),
    title: "Approval requested",
    clientName: r.packet ? `${r.packet.client.firstName} ${r.packet.client.lastName}` : null,
    packetId: r.packetId,
    packetType: r.packet?.packetType ?? null,
    assignedToName: r.approver?.name ?? null,
    assignedToId: null,
    dueDate: null,
    status: r.status,
    lastUpdated: r.updatedAt,
    href: `/approvals/${r.id}`,
  }))
}

export function fromValidations(results: ValidationRow[]): WorkItem[] {
  return results.map((v) => ({
    id: `validation:${v.id}`,
    source: "validation",
    priority: priorityFor(null, v.criticalCount > 0 ? "open" : "completed", v.criticalCount > 0),
    title: v.criticalCount > 0 ? `${v.criticalCount} critical validation issue${v.criticalCount > 1 ? "s" : ""}` : "Validation passed",
    clientName: v.packet ? `${v.packet.client.firstName} ${v.packet.client.lastName}` : null,
    packetId: v.packetId,
    packetType: v.packet?.packetType ?? null,
    assignedToName: null,
    assignedToId: null,
    dueDate: null,
    status: v.criticalCount > 0 ? "failed" : "passed",
    lastUpdated: v.ranAt,
    href: `/validation/${v.id}`,
  }))
}

export const workQueueTabs = [
  { id: "mine", label: "My Tasks" },
  { id: "team", label: "Team Tasks" },
  { id: "unassigned", label: "Unassigned" },
  { id: "overdue", label: "Overdue" },
  { id: "signature", label: "Waiting for Signature" },
  { id: "validation", label: "Validation Required" },
  { id: "approval", label: "Compliance Reviews" },
  { id: "completed", label: "Completed" },
] as const

export function matchesTab(item: WorkItem, tab: string, currentUserId: string): boolean {
  switch (tab) {
    case "mine": return item.source !== "packet" || item.assignedToId === currentUserId
    case "team": return true
    case "unassigned": return item.source === "packet" && !item.assignedToId
    case "overdue": return item.priority === "high" && isOverdue(item.dueDate, item.status)
    case "signature": return item.source === "signature" && !TERMINAL_STATUSES.includes(item.status)
    case "validation": return item.source === "validation" && item.status === "failed"
    case "approval": return item.source === "approval" && item.status === "pending"
    case "completed": return TERMINAL_STATUSES.includes(item.status) || item.status === "passed"
    default: return true
  }
}
