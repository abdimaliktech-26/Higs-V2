import Link from "next/link"
import { StatusChip } from "@/components/ui/status-chip"
import { Button } from "@/components/ui/button"
import { Shield, FileText } from "lucide-react"

interface Props {
  status: string
  progressPct: number
  blockerCount: number
  primaryDocId?: string
  packetId: string
  onRunValidation: () => Promise<void>
}

export function PacketActionBar({ status, progressPct, blockerCount, primaryDocId, onRunValidation }: Props) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-2 flex flex-wrap items-center justify-between gap-4 border-t border-surface-200 bg-white/95 px-6 py-3 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] backdrop-blur">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <StatusChip status={status} size="sm" />
        <span className="text-surface-500">{progressPct}% complete</span>
        {blockerCount > 0 && <span className="font-medium text-danger-600">{blockerCount} blocking issue{blockerCount !== 1 ? "s" : ""}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action={onRunValidation}>
          <Button type="submit" variant="secondary" size="sm"><Shield className="h-4 w-4" /> Validate Packet</Button>
        </form>
        <Link href={primaryDocId ? `/documents/${primaryDocId}/edit` : "#"}>
          <Button size="sm" disabled={!primaryDocId}><FileText className="h-4 w-4" /> Open PDF Editor</Button>
        </Link>
      </div>
    </div>
  )
}
