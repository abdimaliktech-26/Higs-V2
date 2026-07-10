"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Badge, type BadgeProps } from "@/components/ui/badge"

export interface StatusChipProps {
  status: string
  label?: string
  size?: BadgeProps["size"]
  className?: string
}

const statusConfig: Record<string, { variant: BadgeProps["variant"]; label: string }> = {
  active: { variant: "success", label: "Active" },
  inactive: { variant: "secondary", label: "Inactive" },
  draft: { variant: "default", label: "Draft" },
  in_progress: { variant: "info", label: "In Progress" },
  needs_validation: { variant: "warning", label: "Needs Validation" },
  validation_failed: { variant: "danger", label: "Validation Failed" },
  awaiting_signature: { variant: "warning", label: "Awaiting Signature" },
  awaiting_approval: { variant: "warning", label: "Awaiting Approval" },
  approved: { variant: "success", label: "Approved" },
  archived: { variant: "secondary", label: "Archived" },
  complete: { variant: "success", label: "Complete" },
  overdue: { variant: "danger", label: "Overdue" },
  needs_review: { variant: "warning", label: "Needs Review" },
  pending: { variant: "warning", label: "Pending" },
  rejected: { variant: "danger", label: "Rejected" },
  submitted: { variant: "info", label: "Submitted" },
  signed: { variant: "success", label: "Signed" },
  invited: { variant: "info", label: "Invited" },
  disabled: { variant: "secondary", label: "Disabled" },
  suspended: { variant: "danger", label: "Suspended" },
  trial: { variant: "warning", label: "Trial" },
  cancelled: { variant: "secondary", label: "Cancelled" },
}

export function StatusChip({ status, label, size, className }: StatusChipProps) {
  const config = statusConfig[status] ?? { variant: "secondary" as const, label: status.replace(/_/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()) }
  return (
    <Badge variant={config.variant} size={size} dot className={className}>
      {label || config.label}
    </Badge>
  )
}
