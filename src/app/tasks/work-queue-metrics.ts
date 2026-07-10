import type { WorkItem } from "./work-queue-data"

function isToday(date: Date | null): boolean {
  if (!date) return false
  return new Date(date).toDateString() === new Date().toDateString()
}

export interface WorkQueueKpis {
  myWorkloadToday: number
  myOpenTasks: number
  overdueTasks: number
  dueToday: number
  waitingForSignature: number
  validationIssues: number
  completedToday: number
  teamCompletionRatePct: number | null
  avgResolutionHours: number | null
}

/**
 * All counts are derived from the synthesized WorkItem list (itself built
 * from real Packet/SignatureRequest/ApprovalRequest/ValidationResult rows).
 * No new queries, no fabricated numbers.
 */
export function deriveWorkQueueKpis(items: WorkItem[], mine: WorkItem[]): WorkQueueKpis {
  const isTerminal = (i: WorkItem) => ["approved", "archived", "completed", "signed", "declined", "rejected"].includes(i.status) || i.status === "passed"

  const myOpen = mine.filter((i) => !isTerminal(i))
  const myToday = myOpen.filter((i) => isToday(i.dueDate) || i.priority === "high")

  const overdue = items.filter((i) => i.priority === "high" && i.dueDate && new Date(i.dueDate) < new Date())
  const dueToday = items.filter((i) => isToday(i.dueDate))
  const waitingSignature = items.filter((i) => i.source === "signature" && !isTerminal(i))
  const validationIssues = items.filter((i) => i.source === "validation" && i.status === "failed")
  const completedToday = items.filter((i) => isTerminal(i) && isToday(i.lastUpdated))

  const terminalCount = items.filter(isTerminal).length
  const teamCompletionRatePct = items.length > 0 ? Math.round((terminalCount / items.length) * 100) : null

  return {
    myWorkloadToday: myToday.length,
    myOpenTasks: myOpen.length,
    overdueTasks: overdue.length,
    dueToday: dueToday.length,
    waitingForSignature: waitingSignature.length,
    validationIssues: validationIssues.length,
    completedToday: completedToday.length,
    teamCompletionRatePct,
    avgResolutionHours: null,
  }
}

/**
 * Average hours between creation and terminal event, computed only from
 * real timestamp pairs already present on signature/approval rows
 * (createdAt -> signedAt / submittedAt -> decidedAt).
 */
export function deriveAvgResolutionHours(
  signatures: { createdAt: Date; signedAt: Date | null }[],
  approvals: { submittedAt: Date; decidedAt: Date | null }[]
): number | null {
  const deltasMs: number[] = []
  for (const s of signatures) {
    if (s.signedAt) deltasMs.push(s.signedAt.getTime() - s.createdAt.getTime())
  }
  for (const a of approvals) {
    if (a.decidedAt) deltasMs.push(a.decidedAt.getTime() - a.submittedAt.getTime())
  }
  if (deltasMs.length === 0) return null
  const avgMs = deltasMs.reduce((s, d) => s + d, 0) / deltasMs.length
  return Math.round((avgMs / 3600000) * 10) / 10
}

export interface OperationalFocus {
  annualReviewsDue: number
  signatureBlockers: number
  expiringCertifications: number | null
  validationIssues: number
  highRiskClients: number | null
}

export function deriveOperationalFocus(items: WorkItem[]): OperationalFocus {
  const isTerminal = (i: WorkItem) => ["approved", "archived", "completed", "signed", "declined", "rejected"].includes(i.status) || i.status === "passed"
  const annualReviewsDue = items.filter((i) => i.source === "packet" && i.packetType === "annual_review" && !isTerminal(i) && i.dueDate).length
  const signatureBlockers = items.filter((i) => i.source === "signature" && !isTerminal(i)).length
  const validationIssues = items.filter((i) => i.source === "validation" && i.status === "failed").length

  return { annualReviewsDue, signatureBlockers, expiringCertifications: null, validationIssues, highRiskClients: null }
}

export interface WorkloadByAssignee { name: string; count: number }

export function deriveWorkloadByAssignee(items: WorkItem[]): WorkloadByAssignee[] {
  const counts = new Map<string, number>()
  for (const i of items) {
    if (!i.assignedToName) continue
    counts.set(i.assignedToName, (counts.get(i.assignedToName) || 0) + 1)
  }
  return Array.from(counts.entries()).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count)
}
