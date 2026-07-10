import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Mail, Users, CheckCircle2, PencilLine } from "lucide-react"

const NOT_WIRED = "Not part of this presentation pass — no backend source yet"

export function ReviewActionFooter({ documentId }: { documentId: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-surface-200 bg-white px-5 py-4">
      <p className="text-sm text-surface-500">Continue editing or reviewing this document using existing workflows.</p>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Mail className="h-4 w-4" /> Request Missing Information</Button>
        <Button variant="secondary" size="sm" disabled title={NOT_WIRED}><Users className="h-4 w-4" /> Send for Review</Button>
        <Link href={`/documents/${documentId}/edit`}><Button variant="secondary" size="sm"><PencilLine className="h-4 w-4" /> Open in PDF Editor</Button></Link>
        <Button variant="primary" size="sm" disabled title={NOT_WIRED}><CheckCircle2 className="h-4 w-4" /> Complete AI Review</Button>
      </div>
    </div>
  )
}
