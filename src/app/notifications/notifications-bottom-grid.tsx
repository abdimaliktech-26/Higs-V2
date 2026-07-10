import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { EmptyState } from "@/components/ui/states"
import { Megaphone, Mail, CalendarClock, Search, BarChart3, Settings, Bell } from "lucide-react"
import { formatDate } from "@/lib/utils"
import type { UpcomingDeadline } from "./notifications-data"
import type { ActivityCategoryCount } from "./notifications-metrics"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function AnnouncementsCard() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Announcements</CardTitle>
        <Button variant="ghost" size="sm" disabled title={NOT_WIRED}>View all</Button>
      </CardHeader>
      <CardContent>
        <EmptyState className="py-6" icon={<Megaphone className="h-6 w-6" />} title="No announcements yet" description="Org-wide announcements aren't stored yet." />
      </CardContent>
    </Card>
  )
}

export function DailyDigestCard() {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Daily Digest</CardTitle>
        <Button variant="ghost" size="sm" disabled title={NOT_WIRED}>View full digest</Button>
      </CardHeader>
      <CardContent>
        <EmptyState className="py-6" icon={<Mail className="h-6 w-6" />} title="Digest emails coming soon" description="Scheduled daily summaries aren't generated yet." />
      </CardContent>
    </Card>
  )
}

export function UpcomingDeadlinesCard({ deadlines }: { deadlines: UpcomingDeadline[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Upcoming Deadlines</CardTitle>
        <Link href="/packets" className="text-xs font-medium text-brand-600 hover:underline">View all</Link>
      </CardHeader>
      <CardContent>
        {deadlines.length === 0 ? (
          <p className="text-xs text-surface-400">Nothing due in the next 7 days.</p>
        ) : (
          <ul className="space-y-2.5">
            {deadlines.map((d) => (
              <li key={d.packetId} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium text-surface-900">{d.clientName}</p>
                  <p className="truncate text-xs text-surface-400 capitalize">{d.packetType.replace(/_/g, " ")}</p>
                </div>
                <Link href={`/packets/${d.packetId}`} className="shrink-0 text-xs font-medium text-brand-600 hover:underline">{formatDate(d.dueDate)}</Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

export function SearchNotificationsCard({ query }: { query?: string }) {
  return (
    <Card>
      <CardHeader><CardTitle>Search Notifications</CardTitle></CardHeader>
      <CardContent>
        <form className="flex gap-2">
          <Input name="q" defaultValue={query || ""} placeholder="Search title or message…" leftIcon={<Search className="h-4 w-4" />} className="flex-1" />
          <Button type="submit" size="sm">Search</Button>
        </form>
        <p className="mt-2 text-xs text-surface-400">Searches the notifications currently loaded on this page.</p>
      </CardContent>
    </Card>
  )
}

export function ActivityAnalyticsCard({ categories, total }: { categories: ActivityCategoryCount[]; total: number }) {
  const maxCount = Math.max(...categories.map((c) => c.count), 1)
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle>Activity Analytics (30 Days)</CardTitle>
        <Link href="/reports" className="text-xs font-medium text-brand-600 hover:underline">View analytics</Link>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <EmptyState className="py-6" icon={<BarChart3 className="h-6 w-6" />} title="No activity in the last 30 days" />
        ) : (
          <div className="space-y-2.5">
            <p className="text-xs text-surface-500">{total} events</p>
            {categories.map((c) => (
              <div key={c.label}>
                <div className="mb-1 flex justify-between text-xs text-surface-600"><span>{c.label}</span><span>{c.count}</span></div>
                <Progress value={Math.round((c.count / maxCount) * 100)} size="sm" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function NotificationSettingsShortcutCard() {
  return (
    <Card>
      <CardHeader><CardTitle>Notification Settings Shortcut</CardTitle></CardHeader>
      <CardContent className="flex flex-col items-center py-4 text-center">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-50 text-brand-600"><Bell className="h-6 w-6" /></div>
        <p className="text-sm text-surface-500">Manage how and when you receive notifications.</p>
        <a href="#preferences" className="mt-4 w-full">
          <Button variant="secondary" size="sm" fullWidth><Settings className="h-4 w-4" /> Configure Notification Settings</Button>
        </a>
      </CardContent>
    </Card>
  )
}
