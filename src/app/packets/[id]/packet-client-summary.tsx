import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Hash, ChevronRight } from "lucide-react"
import { formatDate } from "@/lib/utils"

interface DiagnosisRow { code: string; description: string | null; type: string }

interface Props {
  clientId: string
  firstName: string
  lastName: string
  mcadId: string | null
  programName: string | null
  caseManagerName: string | null
  diagnoses: DiagnosisRow[]
  dueDate: Date | null
}

export function PacketClientSummary({ clientId, firstName, lastName, mcadId, programName, caseManagerName, diagnoses, dueDate }: Props) {
  const primaryDiagnosis = diagnoses.find((d) => d.type === "primary") ?? diagnoses[0]

  return (
    <Link href={`/clients/${clientId}`} className="-mx-2 flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg p-2 transition-colors hover:bg-surface-50">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700">
          {firstName[0]}{lastName[0]}
        </div>
        <div>
          <p className="text-sm font-medium text-surface-900">{firstName} {lastName}</p>
          <p className="flex items-center gap-1 text-xs text-surface-500"><Hash className="h-3 w-3" />{mcadId || "No 245D ID"}</p>
        </div>
      </div>
      {programName && (
        <div className="text-sm"><span className="text-surface-400">Program </span><span className="text-surface-700">{programName}</span></div>
      )}
      {caseManagerName && (
        <div className="text-sm"><span className="text-surface-400">Case Manager </span><span className="text-surface-700">{caseManagerName}</span></div>
      )}
      {primaryDiagnosis && (
        <div className="text-sm"><span className="text-surface-400">Diagnosis </span><span className="text-surface-700">{primaryDiagnosis.description || primaryDiagnosis.code}</span></div>
      )}
      <div className="text-sm"><span className="text-surface-400">Due </span><span className="text-surface-700">{dueDate ? formatDate(dueDate) : "Not set"}</span></div>
      <ChevronRight className="ml-auto h-4 w-4 text-surface-300" />
    </Link>
  )
}

export function PacketLockBadge({ status }: { status: string }) {
  const isLocked = status === "approved" || status === "archived"
  return (
    <Badge variant={isLocked ? "secondary" : "success"} size="sm">
      {isLocked ? (status === "archived" ? "Archived · Locked" : "Approved · Locked") : "Unlocked"}
    </Badge>
  )
}
