import { Shield, FolderOpen, Scale, Users, FileText, Activity, type LucideIcon } from "lucide-react"

export interface ReportTypeDef {
  id: string
  label: string
  description: string
  icon: LucideIcon
}

export const reportTypes: ReportTypeDef[] = [
  { id: "compliance", label: "Compliance Readiness", description: "Organization health and key compliance metrics", icon: Shield },
  { id: "packets", label: "Packet Completion", description: "Completion status across all client packets", icon: FolderOpen },
  { id: "validation", label: "Validation Issues", description: "Critical and warning validation findings", icon: Scale },
  { id: "staff", label: "Staff Activity", description: "Staff engagement over the last 30 days", icon: Users },
  { id: "documents", label: "Document Library", description: "Document status across the organization", icon: FileText },
  { id: "audit", label: "Audit Summary", description: "System-wide audit event overview", icon: Activity },
]
