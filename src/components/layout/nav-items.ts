export interface NavItem {
  title: string
  href: string
  icon: React.ComponentType<{ className?: string }>
  roles: string[]
  badge?: number
}

import {
  LayoutDashboard,
  Users,
  FolderOpen,
  FileText,
  FileCheck,
  ShieldCheck,
  PenSquare,
  CheckSquare,
  Search,
  SearchCheck,
  BarChart3,
  Library,
  Settings,
  UserCircle,
  HelpCircle,
  Bell,
  CalendarDays,
  Building2,
  GraduationCap,
  BrainCircuit,
  Puzzle,
  Zap,
  ScrollText,
  Gauge,
  ListChecks,
  CreditCard,
  ShieldAlert,
  LineChart,
  PieChart,
  Scale,
  UserCheck,
} from "lucide-react"

export const mainNavItems: NavItem[] = [
  { title: "Super Admin", href: "/super-admin", icon: ShieldAlert, roles: [] },
  { title: "Executive Command", href: "/executive", icon: LineChart, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
  { title: "Analytics Studio", href: "/analytics-studio", icon: PieChart, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "BILLING_ADMIN"] },
  { title: "Dashboard", href: "/dashboard", icon: LayoutDashboard, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN"] },
  { title: "Global Search", href: "/search", icon: Search, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN"] },
  { title: "Clients", href: "/clients", icon: Users, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN"] },
  { title: "Packets", href: "/packets", icon: FolderOpen, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"] },
  { title: "Documents", href: "/library", icon: FileText, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
  { title: "PDF Editor", href: "/library", icon: FileCheck, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
  { title: "Validation", href: "/validation", icon: ShieldCheck, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"] },
  { title: "Signatures", href: "/signatures", icon: PenSquare, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
  { title: "Approvals", href: "/approvals", icon: CheckSquare, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "NURSE"] },
  { title: "Audit Center", href: "/audit", icon: SearchCheck, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "NURSE"] },
  { title: "Reports", href: "/reports", icon: BarChart3, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "BILLING_ADMIN"] },
  { title: "Task & Work Queue", href: "/tasks", icon: ListChecks, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
  { title: "Notifications", href: "/notifications", icon: Bell, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN"] },
  { title: "Calendar", href: "/calendar", icon: CalendarDays, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
  { title: "Document Library", href: "/library", icon: Library, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE"] },
]

export const secondaryNavItems: NavItem[] = [
  { title: "Templates & Forms", href: "/templates", icon: ScrollText, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
  { title: "Organization Settings", href: "/settings/organization", icon: Building2, roles: ["SUPER_ADMIN", "ORG_ADMIN"] },
  { title: "User Management", href: "/settings/users", icon: Users, roles: ["SUPER_ADMIN", "ORG_ADMIN"] },
  { title: "Billing & Subscription", href: "/billing", icon: CreditCard, roles: ["SUPER_ADMIN", "ORG_ADMIN", "BILLING_ADMIN"] },
  { title: "Compliance Rules Engine", href: "/compliance-rules-engine", icon: Scale, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
  { title: "Portal Access", href: "/settings/portal-access", icon: UserCheck, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
]

export const stubNavItems: NavItem[] = [
  { title: "Profile", href: "/settings/profile", icon: UserCircle, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN"] },
  { title: "Help Center", href: "/help", icon: HelpCircle, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER", "DSP", "NURSE", "BILLING_ADMIN"] },
  { title: "Training Center", href: "/training", icon: GraduationCap, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
  { title: "AI Copilot", href: "/ai-copilot", icon: BrainCircuit, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"] },
  { title: "Integrations", href: "/integrations", icon: Puzzle, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
  { title: "Automation Studio", href: "/automation", icon: Zap, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
  { title: "Command Center", href: "/command-center", icon: Gauge, roles: ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR"] },
]
