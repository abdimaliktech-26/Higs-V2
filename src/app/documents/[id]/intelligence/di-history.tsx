import Link from "next/link"
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { EmptyState } from "@/components/ui/states"
import { FileClock, Download } from "lucide-react"
import { formatDateTime } from "@/lib/utils"

interface VersionRow {
  id: string
  version: number
  comment: string | null
  createdAt: Date
  signedUrl: string | null
}

export function DocumentHistoryCard({ versions }: { versions: VersionRow[] }) {
  return (
    <Card id="history">
      <CardHeader><CardTitle>Document History</CardTitle></CardHeader>
      <CardContent>
        {versions.length === 0 ? (
          <EmptyState className="py-8" icon={<FileClock className="h-6 w-6" />} title="No saved versions yet" description="Version history will appear here once this document has been saved more than once." />
        ) : (
          <ul className="space-y-2.5">
            {versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-3 rounded-lg border border-surface-100 p-3 text-sm">
                <div className="min-w-0">
                  <p className="font-medium text-surface-900">Version {v.version}</p>
                  <p className="truncate text-xs text-surface-400">{formatDateTime(v.createdAt)}{v.comment ? ` · ${v.comment}` : ""}</p>
                </div>
                {v.signedUrl && (
                  <Link href={v.signedUrl} target="_blank" className="shrink-0 text-brand-600 hover:text-brand-700" title="Download version">
                    <Download className="h-4 w-4" />
                  </Link>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}
