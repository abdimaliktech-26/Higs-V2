"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { setPacketDocumentPortalVisibility } from "@/lib/actions/documents"
import { Button } from "@/components/ui/button"
import { Select } from "@/components/ui/select"
import { Share2, EyeOff } from "lucide-react"

interface Props {
  documentId: string
  portalVisible: boolean
  portalAccessLevel: string | null
}

const levelOptions = [
  { value: "VIEW", label: "View only" },
  { value: "VIEW_AND_DOWNLOAD", label: "View & download" },
]

export function PortalShareToggle({ documentId, portalVisible, portalAccessLevel }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [level, setLevel] = useState(portalAccessLevel || "VIEW")

  async function share() {
    setLoading(true)
    const result = await setPacketDocumentPortalVisibility(documentId, { portalVisible: true, portalAccessLevel: level as "VIEW" | "VIEW_AND_DOWNLOAD" })
    setLoading(false)
    if (!result.success) { alert(result.error); return }
    setOpen(false)
    router.refresh()
  }

  async function unshare() {
    if (!confirm("Remove portal access to this document? The client will no longer be able to view it.")) return
    setLoading(true)
    const result = await setPacketDocumentPortalVisibility(documentId, { portalVisible: false })
    setLoading(false)
    if (!result.success) { alert(result.error); return }
    router.refresh()
  }

  if (portalVisible) {
    return (
      <Button variant="ghost" size="icon-sm" title="Shared to portal — click to unshare" onClick={unshare} disabled={loading}>
        <Share2 className="h-4 w-4 text-brand-600" />
      </Button>
    )
  }

  if (!open) {
    return (
      <Button variant="ghost" size="icon-sm" title="Share to portal" onClick={() => setOpen(true)}>
        <EyeOff className="h-4 w-4 text-surface-400" />
      </Button>
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Select value={level} onChange={(e) => setLevel(e.target.value)} options={levelOptions} className="h-8 py-1 text-xs" />
      <Button size="sm" onClick={share} disabled={loading}>{loading ? "Sharing..." : "Share"}</Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
    </div>
  )
}
