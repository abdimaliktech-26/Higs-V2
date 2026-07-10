import Link from "next/link"
import { getOrgSettings, getOrgUsers } from "@/lib/actions/users"
import { getClients } from "@/lib/actions/client"
import { getPackets } from "@/lib/actions/templates"
import { getLibraryDashboardSummary, getLibraryDocuments } from "@/lib/actions/library"
import { getAuditDashboardSummary, getAuditEvents } from "@/lib/actions/audit"
import { getAiRecommendations } from "@/lib/actions/ai"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { ErrorState, EmptyState } from "@/components/ui/states"
import { Progress } from "@/components/ui/progress"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { cn, formatDate, timeAgo, truncate } from "@/lib/utils"
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Bot,
  Building2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDollarSign,
  Cloud,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  FileCheck2,
  FileText,
  Gauge,
  Headphones,
  History,
  Infinity,
  KeyRound,
  Layers3,
  LineChart,
  Lock,
  Mail,
  MessageSquare,
  MoreHorizontal,
  PackagePlus,
  Receipt,
  RefreshCw,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  TrendingUp,
  UploadCloud,
  UserCog,
  Users,
  WalletCards,
  Zap,
  type LucideIcon,
} from "lucide-react"

const PRESENTATION_ONLY = "Presentation only - no billing backend is connected"
const COMING_SOON = "Coming Soon - no billing/payment backend exists"

type Org = NonNullable<Awaited<ReturnType<typeof getOrgSettings>>>
type Member = Awaited<ReturnType<typeof getOrgUsers>>[number]
type AuditEvent = Awaited<ReturnType<typeof getAuditEvents>>["events"][number]
type AiRecommendation = Awaited<ReturnType<typeof getAiRecommendations>>[number]

interface Props {
  orgId: string
}

interface Kpi {
  label: string
  value: string
  helper: string
  icon: LucideIcon
  tone: "brand" | "success" | "warning" | "danger" | "purple" | "sky" | "navy" | "teal"
  points: number[]
  presentation?: boolean
}

interface PlanCard {
  name: string
  price: string
  cadence: string
  caption: string
  features: string[]
  current?: boolean
}

export async function BillingContent({ orgId }: Props) {
  let org: Awaited<ReturnType<typeof getOrgSettings>>
  let members: Awaited<ReturnType<typeof getOrgUsers>>
  let clients: Awaited<ReturnType<typeof getClients>>
  let packets: Awaited<ReturnType<typeof getPackets>>
  let librarySummary: Awaited<ReturnType<typeof getLibraryDashboardSummary>>
  let libraryRows: Awaited<ReturnType<typeof getLibraryDocuments>>
  let auditSummary: Awaited<ReturnType<typeof getAuditDashboardSummary>>
  let auditEvents: Awaited<ReturnType<typeof getAuditEvents>>
  let aiRecommendations: Awaited<ReturnType<typeof getAiRecommendations>>

  try {
    [
      org,
      members,
      clients,
      packets,
      librarySummary,
      libraryRows,
      auditSummary,
      auditEvents,
      aiRecommendations,
    ] = await Promise.all([
      getOrgSettings(orgId),
      getOrgUsers(orgId),
      getClients(orgId, { pageSize: 1 }),
      getPackets(orgId, { pageSize: 100 }),
      getLibraryDashboardSummary(orgId),
      getLibraryDocuments(orgId, { tab: "active" }),
      getAuditDashboardSummary(orgId),
      getAuditEvents(orgId, { pageSize: 8 }),
      getAiRecommendations(orgId, { status: "open" }),
    ])
  } catch (e) {
    return <ErrorState title="Error loading billing center" description={(e as Error).message} />
  }

  if (!org) {
    return <EmptyState title="Organization not found" icon={<Building2 className="h-8 w-8 text-surface-400" />} />
  }

  const settings = (org.settings as Record<string, unknown>) || {}
  const activeMembers = members.filter((member) => member.status === "ACTIVE")
  const accountOwner = members.find((member) => member.role === "ORG_ADMIN") ?? members[0] ?? null
  const storageBytes = deriveKnownStorageBytes(libraryRows)
  const subscription = buildSubscription(org, accountOwner, settings, activeMembers.length)
  const kpis = buildKpis(org, members, clients.total, packets.total, librarySummary, storageBytes)
  const usageMetrics = buildUsageMetrics(activeMembers.length, clients.total, packets.total, librarySummary, storageBytes, auditSummary.eventsLast30Days)
  const advisorItems = buildAdvisorItems(activeMembers.length, subscription.licenseLimit, aiRecommendations)

  return (
    <div className="space-y-4 pb-2">
      <BillingHeader org={org} />
      <KpiRow kpis={kpis} />

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.04fr_0.96fr]">
            <CurrentSubscription subscription={subscription} members={activeMembers.length} />
            <PlanComparison currentPlan={org.plan} />
          </div>
          <UsageAnalytics metrics={usageMetrics} />
        </div>
        <BillingSidebar org={org} subscription={subscription} advisorItems={advisorItems} />
      </div>

      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.35fr)_minmax(0,0.95fr)_minmax(0,1fr)_minmax(0,1.05fr)]">
        <LicenseManagement members={members} />
        <PaymentMethods />
        <InvoiceCenter org={org} />
        <AddOnMarketplace />
      </div>

      <BottomDashboard
        subscription={subscription}
        auditEvents={auditEvents.events}
        auditReadinessScore={auditSummary.auditReadinessScore}
        hipaaVerified={Boolean(settings.hipaaVerified)}
      />
    </div>
  )
}

function BillingHeader({ org }: { org: Org }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[24px] font-bold tracking-tight text-navy-950">Billing &amp; Subscription Center</h1>
          <Badge variant="success" size="sm" dot>Live</Badge>
          <Badge variant="secondary" size="sm">Presentation Only</Badge>
        </div>
        <p className="mt-1 max-w-3xl text-xs font-medium text-navy-600">
          Manage subscriptions, licenses, usage, invoices, payments, and organization billing from one secure workspace.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled title={COMING_SOON}><TrendingUp className="h-4 w-4" /> Upgrade Plan</Button>
        <Button size="sm" variant="secondary" disabled title={COMING_SOON}><WalletCards className="h-4 w-4" /> Manage Subscription</Button>
        <Button size="sm" variant="secondary" disabled title={COMING_SOON}><Download className="h-4 w-4" /> Download Invoice</Button>
        <Button asChild size="sm" variant="secondary">
          <Link href="/settings/organization"><Settings className="h-4 w-4" /> Billing Settings</Link>
        </Button>
        <Button size="sm" variant="secondary" disabled title={COMING_SOON}><Headphones className="h-4 w-4" /> Contact Sales</Button>
      </div>
    </div>
  )
}

function KpiRow({ kpis }: { kpis: Kpi[] }) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
      {kpis.map((kpi) => {
        const Icon = kpi.icon
        return (
          <section key={kpi.label} className="min-h-[126px] rounded-lg border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className={cn("flex h-7 w-7 items-center justify-center rounded-md", tone(kpi.tone).soft)}>
                  <Icon className={cn("h-4 w-4", tone(kpi.tone).text)} />
                </span>
                <p className="text-[11px] font-bold text-navy-900">{kpi.label}</p>
              </div>
              {kpi.presentation && <Badge variant="secondary" size="sm">UI</Badge>}
            </div>
            <div className="mt-3 flex items-end justify-between gap-2">
              <p className="truncate text-[24px] font-bold leading-none text-navy-950">{kpi.value}</p>
              <p className={cn("text-[10px] font-bold", kpi.presentation ? "text-surface-400" : tone(kpi.tone).text)}>{kpi.helper}</p>
            </div>
            <MiniSparkline points={kpi.points} tone={kpi.tone} />
          </section>
        )
      })}
    </div>
  )
}

function CurrentSubscription({ subscription, members }: { subscription: ReturnType<typeof buildSubscription>; members: number }) {
  return (
    <section className="rounded-xl border border-surface-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between gap-3 border-b border-surface-100 px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-navy-950">Current Subscription</h2>
          <Badge variant="success" size="sm">Active</Badge>
        </div>
        <Badge variant="secondary" size="sm">Presentation Only</Badge>
      </div>
      <div className="p-4">
        <div className="rounded-xl border border-brand-100 bg-gradient-to-r from-brand-50 to-white p-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div className="flex gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 text-white">
                <Layers3 className="h-6 w-6" />
              </span>
              <div>
                <h3 className="text-base font-bold text-navy-950">Enterprise Healthcare Plan</h3>
                <p className="mt-1 text-xs font-semibold text-surface-600">{subscription.billingCycle} billing - mirrors approved billing mockup</p>
              </div>
            </div>
            <Button size="sm" disabled title={COMING_SOON}>Upgrade Plan</Button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-px border-b border-surface-100 bg-surface-100 text-xs md:grid-cols-4">
          <SubscriptionFact label="Renewal Date" value={subscription.renewalDate} caption="Presentation date" />
          <SubscriptionFact label="Account Owner" value={subscription.ownerName} caption={subscription.ownerEmail} />
          <SubscriptionFact label="Contract Start" value={subscription.contractStart} caption="Presentation date" />
          <SubscriptionFact label="Contract End" value={subscription.contractEnd} caption="Presentation date" />
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-6">
          <LimitChip icon={Users} label="Users" value={`${members}/${subscription.licenseLimit}`} />
          <LimitChip icon={UserCog} label="Clients" value="Unlimited" presentation />
          <LimitChip icon={Sparkles} label="AI Credits / Month" value={subscription.aiCreditLimit} presentation />
          <LimitChip icon={Cloud} label="Storage" value={subscription.storageLimit} presentation />
          <LimitChip icon={Headphones} label="Support Tier" value="Premium" presentation />
          <LimitChip icon={Gauge} label="SLA Uptime" value="99.9%" presentation />
        </div>

        <div className="mt-4 rounded-xl border border-surface-200 bg-[#fbfdff] p-4">
          <p className="mb-3 text-xs font-bold text-navy-900">Included Features</p>
          <div className="grid grid-cols-1 gap-2 text-xs font-semibold text-navy-800 sm:grid-cols-2">
            {["HIPAA Compliance", "Single Sign-On (SSO)", "AI Document Intelligence", "Advanced Workflows", "Custom Reports", "API Access", "Audit Center", "Priority Support"].map((feature) => (
              <span key={feature} className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5 text-success-600" />
                {feature}
              </span>
            ))}
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button size="sm" variant="secondary" disabled title={COMING_SOON}>Renew Now</Button>
            <Button size="sm" variant="secondary" disabled title={COMING_SOON}>Compare Plans</Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function PlanComparison({ currentPlan }: { currentPlan: string }) {
  const plans: PlanCard[] = [
    {
      name: "Professional",
      price: "$499",
      cadence: "/mo",
      caption: "Billed annually",
      features: ["Up to 50 users", "500 clients", "Standard AI", "Email support", "Basic reports", "Community access"],
      current: normalizePlan(currentPlan) === "professional",
    },
    {
      name: "Enterprise",
      price: "$1,499",
      cadence: "/mo",
      caption: "Billed annually",
      features: ["Unlimited users", "Unlimited clients", "Advanced AI", "HIPAA compliant", "SSO & MFA", "Custom branding", "API access", "Priority support"],
      current: normalizePlan(currentPlan) === "enterprise" || !["professional", "enterprise_plus"].includes(normalizePlan(currentPlan)),
    },
    {
      name: "Enterprise Plus",
      price: "$2,999",
      cadence: "/mo",
      caption: "Billed annually",
      features: ["Everything in Enterprise", "Dedicated account manager", "Unlimited AI credits", "Priority infrastructure", "White labeling", "Custom integrations", "Executive onboarding", "99.99% SLA"],
      current: normalizePlan(currentPlan) === "enterprise_plus",
    },
  ]

  return (
    <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-bold text-navy-950">Plan Comparison</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-brand-200 bg-brand-50 px-2.5 py-1 text-[11px] font-bold text-brand-700">Annual</span>
          <span title={COMING_SOON} className="rounded-full border border-surface-200 bg-surface-50 px-2.5 py-1 text-[11px] font-bold text-surface-400">Monthly</span>
          <Badge variant="success" size="sm">Save 17%</Badge>
        </div>
      </div>
      <div className="mt-4 grid grid-cols-1 gap-3 lg:grid-cols-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className={cn(
              "relative rounded-xl border bg-white p-4",
              plan.current ? "border-brand-400 shadow-[0_12px_28px_rgba(37,99,235,0.13)]" : "border-surface-200"
            )}
          >
            {plan.current && (
              <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-brand-600 px-3 py-1 text-[10px] font-bold text-white">
                Current Plan
              </div>
            )}
            <h3 className="text-sm font-bold text-navy-950">{plan.name}</h3>
            <div className="mt-3 flex items-end gap-1">
              <span className="text-[26px] font-bold text-navy-950">{plan.price}</span>
              <span className="pb-1 text-xs font-semibold text-navy-700">{plan.cadence}</span>
            </div>
            <p className="mt-1 text-xs font-medium text-surface-500">{plan.caption}</p>
            <div className="mt-4 space-y-2">
              {plan.features.map((feature) => (
                <p key={feature} className="flex items-center gap-2 text-xs font-medium text-navy-700">
                  <Check className="h-3.5 w-3.5 text-success-600" />
                  {feature}
                </p>
              ))}
            </div>
            <Button size="sm" fullWidth className="mt-5" variant={plan.current ? "primary" : "secondary"} disabled title={COMING_SOON}>
              {plan.current ? "Current Plan" : "Select Plan"}
            </Button>
          </div>
        ))}
      </div>
      <div className="mt-3 text-center">
        <Button size="sm" variant="link" disabled title={COMING_SOON}>
          View all features comparison
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </section>
  )
}

function BillingSidebar({
  org,
  subscription,
  advisorItems,
}: {
  org: Org
  subscription: ReturnType<typeof buildSubscription>
  advisorItems: ReturnType<typeof buildAdvisorItems>
}) {
  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-950">Subscription Summary</h2>
          <Button size="sm" variant="link" disabled title={COMING_SOON}>View all</Button>
        </div>
        <div className="mt-4 space-y-3 text-xs">
          <SummaryRow label="Plan" value={subscription.planLabel} />
          <SummaryRow label="Billing Cycle" value={subscription.billingCycle} />
          <SummaryRow label="Payment Method" value="Presentation card" badge="UI" />
          <SummaryRow label="Billing Email" value={subscription.ownerEmail} />
          <SummaryRow label="Tax ID" value="Coming Soon" muted />
          <SummaryRow label="Auto-Renew" value="Enabled" badge="UI" />
          <SummaryRow label="Currency" value="USD" />
          <SummaryRow label="Organization" value={org.name} />
        </div>
        <Button size="sm" variant="link" disabled title={COMING_SOON} className="mt-3 px-0">
          Manage subscription
          <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold text-navy-950">AI Billing Advisor</h2>
            <Badge variant="info" size="sm">Beta</Badge>
          </div>
          <Badge variant="secondary" size="sm">Coming Soon</Badge>
        </div>
        <div className="space-y-3">
          {advisorItems.map((item) => {
            const Icon = item.icon
            return (
              <div key={item.title} className={cn("rounded-xl border p-3", item.tone === "danger" ? "border-danger-100 bg-danger-50/50" : item.tone === "warning" ? "border-warning-100 bg-warning-50/50" : "border-surface-200 bg-[#fbfdff]")}>
                <div className="flex gap-3">
                  <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", tone(item.tone).soft)}>
                    <Icon className={cn("h-4 w-4", tone(item.tone).text)} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-bold text-navy-950">{item.title}</p>
                    <p className="mt-1 text-[11px] leading-4 text-surface-500">{item.description}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Badge variant={item.tone === "danger" ? "danger" : item.tone === "warning" ? "warning" : "info"} size="sm">{item.impact}</Badge>
                      <Badge variant="secondary" size="sm">Confidence {item.confidence}%</Badge>
                    </div>
                  </div>
                  <Button size="sm" variant="secondary" disabled title={COMING_SOON}>{item.action}</Button>
                </div>
              </div>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function UsageAnalytics({ metrics }: { metrics: ReturnType<typeof buildUsageMetrics> }) {
  return (
    <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-bold text-navy-950">Usage Analytics</h2>
        <Badge variant="secondary" size="sm">Mixed real and UI-only metrics</Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-8">
        {metrics.map((metric) => {
          const Icon = metric.icon
          return (
            <div key={metric.label} className="rounded-lg border border-surface-200 bg-[#fbfdff] p-3">
              <div className="flex items-center justify-between gap-2">
                <Icon className={cn("h-4 w-4", tone(metric.tone).text)} />
                {metric.presentation && <Badge variant="secondary" size="sm">UI</Badge>}
              </div>
              <p className="mt-3 text-lg font-bold text-navy-950">{metric.value}</p>
              <p className="text-[11px] font-bold text-navy-800">{metric.label}</p>
              <p className={cn("mt-1 text-[10px] font-bold", metric.presentation ? "text-surface-400" : "text-success-600")}>{metric.helper}</p>
              <MiniSparkline points={metric.points} tone={metric.tone} compact />
            </div>
          )
        })}
      </div>
    </section>
  )
}

function LicenseManagement({ members }: { members: Member[] }) {
  return (
    <section className="rounded-xl border border-surface-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-surface-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-navy-950">License Management</h2>
          <p className="mt-0.5 text-[11px] font-medium text-surface-500">{members.length} real organization user{members.length === 1 ? "" : "s"}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" disabled title={COMING_SOON}>Assign</Button>
          <Button size="sm" variant="secondary" disabled title={COMING_SOON}>Remove</Button>
          <Button size="sm" variant="secondary" disabled title={COMING_SOON}>Upgrade</Button>
          <Button size="icon-sm" variant="ghost" disabled title={COMING_SOON}><MoreHorizontal className="h-4 w-4" /></Button>
        </div>
      </div>
      {members.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-xs">
            <thead>
              <tr className="border-b border-surface-100 bg-[#fbfdff] text-left text-[10px] uppercase tracking-wide text-surface-500">
                <th className="px-4 py-2 font-bold">User</th>
                <th className="px-3 py-2 font-bold">Role</th>
                <th className="px-3 py-2 font-bold">License Type</th>
                <th className="px-3 py-2 font-bold">Status</th>
                <th className="px-3 py-2 font-bold">Last Active</th>
                <th className="px-3 py-2 font-bold">Department</th>
                <th className="px-3 py-2 font-bold">Assigned Date</th>
                <th className="px-3 py-2 font-bold">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-100">
              {members.slice(0, 6).map((member) => (
                <tr key={member.id} className="hover:bg-surface-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Avatar size="sm">
                        <AvatarFallback name={member.user.name || member.user.email} />
                      </Avatar>
                      <div>
                        <p className="font-bold text-navy-950">{member.user.name || "Unnamed user"}</p>
                        <p className="text-[11px] text-surface-500">{member.user.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-3"><Badge variant="secondary" size="sm">{roleLabel(member.role)}</Badge></td>
                  <td className="px-3 py-3 font-semibold text-navy-800">{licenseType(member.role)}</td>
                  <td className="px-3 py-3"><Badge variant={member.status === "ACTIVE" ? "success" : "secondary"} size="sm" dot>{member.status}</Badge></td>
                  <td className="px-3 py-3 text-surface-500">Coming Soon</td>
                  <td className="px-3 py-3 text-navy-800">{firstDepartment(member)}</td>
                  <td className="px-3 py-3 text-surface-500">{formatDate(member.createdAt)}</td>
                  <td className="px-3 py-3">
                    <Button size="icon-sm" variant="ghost" disabled title={COMING_SOON}><MoreHorizontal className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-6">
          <EmptyState title="No users available" description="Real organization users will appear here." icon={<Users className="h-8 w-8 text-surface-400" />} />
        </div>
      )}
    </section>
  )
}

function PaymentMethods() {
  const methods = [
    { icon: CreditCard, title: "Corporate Visa", subtitle: "VISA **** 4242", badge: "Default", tone: "brand" as const },
    { icon: WalletCards, title: "ACH Bank Transfer", subtitle: "Account **** 6789", badge: "UI", tone: "navy" as const },
    { icon: Receipt, title: "Purchase Order", subtitle: "PO # PO-2026-678", badge: "UI", tone: "sky" as const },
  ]
  return (
    <section className="rounded-xl border border-surface-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between border-b border-surface-100 px-4 py-3">
        <h2 className="text-sm font-bold text-navy-950">Payment Methods</h2>
        <Button size="sm" variant="link" disabled title={COMING_SOON}>+ Add Payment Method</Button>
      </div>
      <div className="space-y-3 p-4">
        {methods.map((method) => {
          const Icon = method.icon
          return (
            <div key={method.title} className="rounded-xl border border-surface-200 bg-[#fbfdff] p-3">
              <div className="flex items-center gap-3">
                <span className={cn("flex h-9 w-9 items-center justify-center rounded-lg", tone(method.tone).soft)}>
                  <Icon className={cn("h-4 w-4", tone(method.tone).text)} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold text-navy-950">{method.title}</p>
                  <p className="text-[11px] font-medium text-surface-500">{method.subtitle}</p>
                </div>
                <Badge variant={method.badge === "Default" ? "success" : "secondary"} size="sm">{method.badge}</Badge>
                <Button size="icon-sm" variant="ghost" disabled title={COMING_SOON}><MoreHorizontal className="h-4 w-4" /></Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function InvoiceCenter({ org }: { org: Org }) {
  const invoices = [
    { id: "INV-2026-0515", period: "May 15 - Jun 15, 2026", amount: "$24,560.00", status: "Paid" },
    { id: "INV-2026-0415", period: "Apr 15 - May 15, 2026", amount: "$24,560.00", status: "Paid" },
    { id: "INV-2026-0315", period: "Mar 15 - Apr 15, 2026", amount: "$24,560.00", status: "Paid" },
    { id: "INV-2026-0215", period: "Feb 15 - Mar 15, 2026", amount: "$24,560.00", status: "Paid" },
    { id: "INV-2026-0115", period: "Jan 15 - Feb 15, 2026", amount: "$24,560.00", status: "Paid" },
    { id: "INV-2025-1215", period: "Dec 15 - Jan 15, 2026", amount: "$24,560.00", status: "Overdue" },
  ]
  return (
    <section className="rounded-xl border border-surface-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between border-b border-surface-100 px-4 py-3">
        <div>
          <h2 className="text-sm font-bold text-navy-950">Invoice Center</h2>
          <p className="text-[11px] text-surface-500">{org.name}</p>
        </div>
        <Button size="sm" variant="link" disabled title={COMING_SOON}>View all invoices</Button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-xs">
          <thead>
            <tr className="border-b border-surface-100 bg-[#fbfdff] text-left text-[10px] uppercase tracking-wide text-surface-500">
              <th className="px-4 py-2 font-bold">Invoice #</th>
              <th className="px-3 py-2 font-bold">Billing Period</th>
              <th className="px-3 py-2 font-bold">Amount</th>
              <th className="px-3 py-2 font-bold">Status</th>
              <th className="px-3 py-2 font-bold">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-100">
            {invoices.map((invoice) => (
              <tr key={invoice.id}>
                <td className="px-4 py-2 font-bold text-brand-700">{invoice.id}</td>
                <td className="px-3 py-2 text-navy-800">{invoice.period}</td>
                <td className="px-3 py-2 font-semibold text-navy-950">{invoice.amount}</td>
                <td className="px-3 py-2"><Badge variant={invoice.status === "Paid" ? "success" : "danger"} size="sm">{invoice.status}</Badge></td>
                <td className="px-3 py-2">
                  <Button size="icon-sm" variant="ghost" disabled title={COMING_SOON}><Download className="h-4 w-4" /></Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="border-t border-surface-100 px-4 py-2">
        <Badge variant="secondary" size="sm">Presentation-only invoice data</Badge>
      </div>
    </section>
  )
}

function AddOnMarketplace() {
  const addOns = [
    { title: "AI Credit Pack", subtitle: "100K credits", price: "$199/mo", icon: Sparkles },
    { title: "Additional Storage", subtitle: "1 TB", price: "$149/mo", icon: Cloud },
    { title: "Extra Organizations", subtitle: "Per org", price: "$99/mo", icon: Building2 },
    { title: "SMS Notifications", subtitle: "10K messages", price: "$89/mo", icon: MessageSquare },
    { title: "Premium OCR", subtitle: "Advanced OCR", price: "$129/mo", icon: FileText },
    { title: "Dedicated Support", subtitle: "24/7 priority", price: "$499/mo", icon: Headphones },
    { title: "Advanced Analytics", subtitle: "Executive BI", price: "$199/mo", icon: BarChart3 },
    { title: "API Expansion", subtitle: "Higher limits", price: "$149/mo", icon: KeyRound },
  ]
  return (
    <section className="rounded-xl border border-surface-200 bg-white shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
      <div className="flex items-center justify-between border-b border-surface-100 px-4 py-3">
        <h2 className="text-sm font-bold text-navy-950">Add-On Marketplace</h2>
        <Button size="sm" variant="link" disabled title={COMING_SOON}>View all add-ons</Button>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4">
        {addOns.map((addOn) => {
          const Icon = addOn.icon
          return (
            <div key={addOn.title} className="rounded-lg border border-surface-200 bg-[#fbfdff] p-3">
              <Icon className="h-4 w-4 text-brand-700" />
              <p className="mt-2 text-xs font-bold text-navy-950">{addOn.title}</p>
              <p className="text-[10px] font-semibold text-surface-500">{addOn.subtitle}</p>
              <div className="mt-3 flex items-center justify-between gap-2">
                <span className="text-xs font-bold text-navy-950">{addOn.price}</span>
                <Button size="sm" variant="secondary" disabled title={COMING_SOON}>Add</Button>
              </div>
            </div>
          )
        })}
      </div>
    </section>
  )
}

function BottomDashboard({
  subscription,
  auditEvents,
  auditReadinessScore,
  hipaaVerified,
}: {
  subscription: ReturnType<typeof buildSubscription>
  auditEvents: AuditEvent[]
  auditReadinessScore: number | null
  hipaaVerified: boolean
}) {
  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.05fr_0.9fr_1.35fr_1.05fr_0.9fr]">
      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-950">Renewal Timeline</h2>
          <Badge variant="secondary" size="sm">UI</Badge>
        </div>
        <div className="mt-6 grid grid-cols-4 gap-2">
          {["Contract Started", "Mid-Term Review", "Renewal Reminder", "Renewal Date"].map((label, index) => (
            <div key={label} className="relative text-center">
              <span className={cn("mx-auto flex h-4 w-4 items-center justify-center rounded-full", index < 2 ? "bg-brand-600" : "bg-surface-200")}>
                <span className="h-1.5 w-1.5 rounded-full bg-white" />
              </span>
              <p className="mt-3 text-[10px] font-bold text-navy-900">{label}</p>
              <p className="mt-1 text-[10px] text-surface-500">{index === 3 ? subscription.renewalDate : "Presentation"}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-bold text-navy-950">Cost Breakdown</h2>
        <div className="mt-4 flex items-center gap-4">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full bg-[conic-gradient(#2563eb_0_52%,#10b981_52%_72%,#f59e0b_72%_84%,#8b5cf6_84%_94%,#e5e7eb_94%_100%)]">
            <div className="flex h-16 w-16 flex-col items-center justify-center rounded-full bg-white">
              <span className="text-sm font-bold text-navy-950">$24,560</span>
              <span className="text-[10px] text-surface-500">Total</span>
            </div>
          </div>
          <div className="space-y-2 text-[11px] font-semibold">
            {["Base Subscription", "User Licenses", "AI Usage", "Storage", "Add-Ons"].map((label, index) => (
              <div key={label} className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", ["bg-brand-600", "bg-success-600", "bg-warning-500", "bg-violet-600", "bg-surface-400"][index])} />
                <span className="text-navy-800">{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-950">Billing Forecast</h2>
          <Badge variant="secondary" size="sm">Next 12 Months</Badge>
        </div>
        <div className="mt-4 flex h-32 items-end gap-2">
          {[14, 18, 21, 16, 20, 24, 28, 31, 34, 37, 33, 36].map((height, index) => (
            <div key={`${height}-${index}`} className="flex flex-1 flex-col items-center gap-1">
              <div className={cn("w-full rounded-t", index < 6 ? "bg-brand-600" : "bg-brand-100")} style={{ height: `${height * 2.5}px` }} />
              <span className="text-[9px] font-bold text-surface-400">{["M", "J", "J", "A", "S", "O", "N", "D", "J", "F", "M", "A"][index]}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-navy-950">Audit &amp; Billing History</h2>
          <Link href="/audit" className="text-[11px] font-bold text-brand-700">View audit</Link>
        </div>
        <div className="mt-4 space-y-3">
          {auditEvents.slice(0, 4).map((event) => (
            <div key={event.id} className="flex gap-2">
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-success-50 text-success-700">
                <History className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="truncate text-xs font-bold text-navy-900">{humanize(event.action)}</p>
                <p className="text-[10px] text-surface-500">{timeAgo(event.createdAt)}</p>
              </div>
            </div>
          ))}
          <Badge variant="secondary" size="sm">Billing-specific audit events Coming Soon</Badge>
        </div>
      </section>

      <section className="rounded-xl border border-surface-200 bg-white p-4 shadow-[0_8px_22px_rgba(15,23,42,0.04)]">
        <h2 className="text-sm font-bold text-navy-950">Security &amp; Compliance</h2>
        <div className="mt-4 space-y-3">
          <ComplianceRow label="PCI Compliant" value="Coming Soon" />
          <ComplianceRow label="HIPAA Secure Billing" value={hipaaVerified ? "Verified" : "Not configured"} verified={hipaaVerified} />
          <ComplianceRow label="Encrypted Payment Processing" value="AES-256" presentation />
          <ComplianceRow label="Tax Compliance" value="Up to date" presentation />
          <ComplianceRow label="Invoice Retention Policy" value={`${auditReadinessScore ?? 0}% readiness`} />
        </div>
        <Button size="sm" variant="link" disabled title={COMING_SOON} className="mt-3 px-0">
          View compliance center
          <ArrowRight className="h-4 w-4" />
        </Button>
      </section>
    </div>
  )
}

function SubscriptionFact({ label, value, caption }: { label: string; value: string; caption: string }) {
  return (
    <div className="bg-white p-4">
      <p className="text-[10px] font-bold uppercase tracking-wide text-surface-500">{label}</p>
      <p className="mt-2 text-xs font-bold text-navy-950">{value}</p>
      <p className="mt-1 truncate text-[10px] text-surface-500">{caption}</p>
    </div>
  )
}

function LimitChip({ icon: Icon, label, value, presentation }: { icon: LucideIcon; label: string; value: string; presentation?: boolean }) {
  return (
    <div className="rounded-lg border border-surface-200 bg-[#fbfdff] p-3">
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 text-brand-700" />
        <p className="text-[10px] font-bold uppercase tracking-wide text-surface-500">{label}</p>
      </div>
      <p className="mt-2 truncate text-xs font-bold text-navy-950">{value}</p>
      {presentation && <p className="mt-1 text-[10px] font-semibold text-surface-400">Presentation only</p>}
    </div>
  )
}

function SummaryRow({ label, value, badge, muted }: { label: string; value: string; badge?: string; muted?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="font-medium text-surface-500">{label}</span>
      <span className={cn("truncate text-right font-bold", muted ? "text-surface-400" : "text-navy-900")}>{value}</span>
      {badge && <Badge variant={badge === "UI" ? "secondary" : "success"} size="sm">{badge}</Badge>}
    </div>
  )
}

function ComplianceRow({ label, value, verified, presentation }: { label: string; value: string; verified?: boolean; presentation?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <span className="flex items-center gap-2 font-semibold text-navy-800">
        <ShieldCheck className="h-3.5 w-3.5 text-brand-700" />
        {label}
      </span>
      <Badge variant={verified || presentation ? "success" : "secondary"} size="sm">{value}</Badge>
    </div>
  )
}

function MiniSparkline({ points, tone: toneName, compact }: { points: number[]; tone: Kpi["tone"]; compact?: boolean }) {
  const max = Math.max(...points, 1)
  return (
    <div className={cn("mt-4 flex items-end gap-1", compact ? "h-7" : "h-9")}>
      {points.map((point, index) => (
        <span
          key={`${point}-${index}`}
          className={cn("flex-1 rounded-full", tone(toneName).bar)}
          style={{ height: `${Math.max(16, (point / max) * 100)}%` }}
        />
      ))}
    </div>
  )
}

function buildKpis(
  org: Org,
  members: Member[],
  clientCount: number,
  packetCount: number,
  librarySummary: Awaited<ReturnType<typeof getLibraryDashboardSummary>>,
  storageBytes: number
): Kpi[] {
  const activeLicenses = members.filter((member) => member.status === "ACTIVE").length
  const licenseLimit = 600
  return [
    { label: "Current Monthly Cost", value: "$24,560.00", helper: "+8.2% vs last month", icon: CircleDollarSign, tone: "brand", points: [9, 14, 18, 22, 24, 18, 25, 20, 17], presentation: true },
    { label: "Active Licenses", value: String(activeLicenses), helper: `${members.length} total users`, icon: Users, tone: "success", points: [10, 12, 14, 14, 16, 13, 15, 17, 14] },
    { label: "Available Licenses", value: String(Math.max(0, licenseLimit - activeLicenses)), helper: "limit is UI only", icon: UserCog, tone: "purple", points: [18, 18, 19, 20, 18, 17, 20, 18, 17], presentation: true },
    { label: "AI Credits Remaining", value: "245,680", helper: "+16% vs last month", icon: Sparkles, tone: "warning", points: [8, 13, 16, 17, 18, 12, 19, 14, 12], presentation: true },
    { label: "Storage Used", value: storageBytes ? formatBytes(storageBytes) : "1.42 TB", helper: storageBytes ? "file metadata" : "UI placeholder", icon: Cloud, tone: "brand", points: [12, 14, 10, 16, 20, 14, 18, 13, 19], presentation: !storageBytes },
    { label: "Organizations Managed", value: "1", helper: org.name, icon: Building2, tone: "teal", points: [10, 12, 11, 10, 9, 12, 10, 9, 8] },
    { label: "Current Plan", value: planLabel(org.plan), helper: "organization plan", icon: Star, tone: "navy", points: [12, 12, 12, 12, 12, 12, 12, 12, 12] },
    { label: "Subscription Summary", value: String(packetCount + clientCount + librarySummary.totalDocuments), helper: "real records", icon: Receipt, tone: "sky", points: [11, 12, 15, 13, 17, 18, 16, 20, 21] },
  ]
}

function buildUsageMetrics(activeUsers: number, clientCount: number, packetCount: number, librarySummary: Awaited<ReturnType<typeof getLibraryDashboardSummary>>, storageBytes: number, eventsLast30Days: number) {
  return [
    { label: "Active Users", value: String(activeUsers), helper: "real org users", icon: Users, tone: "brand" as const, points: [8, 9, 10, 8, 11, 10, 12, 13] },
    { label: "Client Count", value: formatNumber(clientCount), helper: "real clients", icon: UserCog, tone: "success" as const, points: [10, 11, 12, 11, 14, 12, 15, 14] },
    { label: "Storage Used", value: storageBytes ? formatBytes(storageBytes) : "1.42 TB", helper: storageBytes ? "file metadata" : "UI placeholder", icon: Cloud, tone: "purple" as const, points: [10, 14, 12, 16, 14, 18, 15, 20], presentation: !storageBytes },
    { label: "AI Credits Used", value: "254,320", helper: "+8.2%", icon: Sparkles, tone: "warning" as const, points: [8, 14, 16, 12, 18, 10, 15, 19], presentation: true },
    { label: "PDF Processed", value: formatNumber(librarySummary.totalDocuments), helper: "real document count", icon: FileText, tone: "brand" as const, points: [9, 12, 10, 13, 11, 9, 12, 16] },
    { label: "OCR Pages", value: "312,650", helper: "+11.3%", icon: FileCheck2, tone: "teal" as const, points: [10, 11, 12, 10, 13, 15, 18, 20], presentation: true },
    { label: "API Requests", value: formatCompact(eventsLast30Days * 32), helper: "audit-derived", icon: Database, tone: "purple" as const, points: [8, 9, 14, 15, 12, 16, 19, 18] },
    { label: "Integration Calls", value: formatCompact(packetCount * 47), helper: "UI estimate", icon: Zap, tone: "warning" as const, points: [8, 9, 7, 11, 13, 9, 14, 10], presentation: true },
  ]
}

function buildSubscription(org: Org, accountOwner: Member | null, settings: Record<string, unknown>, activeMembers: number) {
  return {
    planLabel: `${planLabel(org.plan)} Healthcare`,
    billingCycle: "Annual",
    renewalDate: "May 15, 2026",
    contractStart: "May 15, 2025",
    contractEnd: "May 15, 2026",
    ownerName: accountOwner?.user.name || accountOwner?.user.email || "Not assigned",
    ownerEmail: accountOwner?.user.email || String(settings.billingEmail || "Not configured"),
    licenseLimit: Math.max(600, activeMembers),
    aiCreditLimit: "500,000",
    storageLimit: "2 TB",
  }
}

function buildAdvisorItems(activeMembers: number, licenseLimit: number, aiRecommendations: AiRecommendation[]) {
  const unusedLicenses = Math.max(0, licenseLimit - activeMembers)
  return [
    {
      title: "You could save $5,280 (18%)",
      description: "Optimize unused presentation licenses before renewal.",
      action: "Apply",
      confidence: 92,
      impact: "High Impact",
      tone: "danger" as const,
      icon: CircleDollarSign,
    },
    {
      title: `${unusedLicenses} unused licenses detected.`,
      description: "Reclaiming licenses requires a billing backend.",
      action: "Review",
      confidence: 86,
      impact: "Medium Impact",
      tone: "success" as const,
      icon: Users,
    },
    {
      title: "AI credits projected to run out.",
      description: aiRecommendations.length ? `${aiRecommendations.length} open AI recommendation records exist.` : "AI credit usage is not connected yet.",
      action: "Buy Credits",
      confidence: 90,
      impact: "High Impact",
      tone: "warning" as const,
      icon: Sparkles,
    },
    {
      title: "Storage usage is at 78%.",
      description: "Storage quota is presentation-only until billing telemetry exists.",
      action: "View Storage",
      confidence: 85,
      impact: "Medium Impact",
      tone: "warning" as const,
      icon: Cloud,
    },
    {
      title: "Upgrade to Enterprise Plus",
      description: "Advanced AI and dedicated support are not purchasable yet.",
      action: "Learn More",
      confidence: 70,
      impact: "Low Impact",
      tone: "purple" as const,
      icon: PackagePlus,
    },
  ]
}

function deriveKnownStorageBytes(rows: Awaited<ReturnType<typeof getLibraryDocuments>>): number {
  const templateBytes = rows.templates.reduce((sum, doc) => sum + (doc.fileSize || 0), 0)
  const supportingBytes = rows.supportingDocs.reduce((sum, doc) => sum + (doc.fileSize || 0), 0)
  return templateBytes + supportingBytes
}

function tone(name: Kpi["tone"] | "danger") {
  const map = {
    brand: { soft: "bg-brand-50", text: "text-brand-700", bar: "bg-brand-600" },
    success: { soft: "bg-success-50", text: "text-success-700", bar: "bg-success-600" },
    warning: { soft: "bg-warning-50", text: "text-warning-700", bar: "bg-warning-500" },
    danger: { soft: "bg-danger-50", text: "text-danger-700", bar: "bg-danger-500" },
    purple: { soft: "bg-violet-50", text: "text-violet-700", bar: "bg-violet-600" },
    sky: { soft: "bg-sky-50", text: "text-sky-700", bar: "bg-sky-600" },
    navy: { soft: "bg-navy-50", text: "text-navy-700", bar: "bg-navy-700" },
    teal: { soft: "bg-teal-50", text: "text-teal-700", bar: "bg-teal-600" },
  }
  return map[name]
}

function planLabel(plan: string): string {
  const normalized = normalizePlan(plan)
  if (normalized === "professional") return "Professional"
  if (normalized === "enterprise_plus") return "Enterprise Plus"
  if (normalized === "enterprise") return "Enterprise"
  if (normalized === "starter") return "Starter"
  return humanize(plan)
}

function normalizePlan(plan: string): string {
  return plan.toLowerCase().replace(/[\s-]+/g, "_")
}

function roleLabel(role: string): string {
  return humanize(role).replace("Org", "Org")
}

function licenseType(role: string): string {
  if (["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "BILLING_ADMIN"].includes(role)) return "Full User"
  if (["CASE_MANAGER", "NURSE"].includes(role)) return "Mobile User"
  return "Read Only"
}

function firstDepartment(member: Member): string {
  const departments = (member.departments as string[]) || []
  return departments[0] || "Not assigned"
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 MB"
  const units = ["B", "KB", "MB", "GB", "TB"]
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en-US").format(value)
}

function formatCompact(value: number): string {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value)
}
