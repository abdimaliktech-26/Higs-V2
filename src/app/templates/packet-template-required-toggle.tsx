"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { updatePacketTemplateDocumentRequired } from "@/lib/actions/templates"
import { Badge } from "@/components/ui/badge"

interface Props {
  packetTemplateDocumentId: string
  required: boolean
  canManage: boolean
}

export function PacketTemplateRequiredToggle({ packetTemplateDocumentId, required, canManage }: Props) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  if (!canManage) {
    return <Badge variant={required ? "warning" : "secondary"} size="sm">{required ? "Required" : "Optional"}</Badge>
  }

  function handleClick() {
    setError(null)
    startTransition(async () => {
      const result = await updatePacketTemplateDocumentRequired(packetTemplateDocumentId, !required)
      if (!result.success) setError(result.error)
      else router.refresh()
    })
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      title="Click to toggle required/optional"
      className="cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
    >
      <Badge variant={required ? "warning" : "secondary"} size="sm">{required ? "Required" : "Optional"}</Badge>
      {error && <span className="ml-1 text-xs text-danger-600">{error}</span>}
    </button>
  )
}
