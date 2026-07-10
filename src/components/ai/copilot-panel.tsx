"use client"

import { useState } from "react"
import Link from "next/link"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import { Progress } from "@/components/ui/progress"
import { Alert } from "@/components/ui/alert"
import {
  BrainCircuit, Sparkles, AlertTriangle, CheckCircle2, Lightbulb,
  FileSearch, BarChart3, RefreshCw, ThumbsUp, X, Loader2
} from "lucide-react"
import { cn } from "@/lib/utils"

interface AiCopilotPanelProps {
  documentId: string
  fields: { id: string; name: string; fieldType: string; value: string | null; isRequired: boolean }[]
  onRefresh?: () => void
  className?: string
}

export function AiCopilotPanel({ documentId, fields, onRefresh, className }: AiCopilotPanelProps) {
  const [extracting, setExtracting] = useState(false)
  const [result, setResult] = useState<{ overallConfidence: number; suggestionsCount: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const runExtraction = async () => {
    setExtracting(true); setError(null)
    try {
      const { runDocumentExtraction } = await import("@/lib/actions/ai")
      const r = await runDocumentExtraction(documentId)
      if (r.success) {
        setResult({ overallConfidence: r.data.overallConfidence as number, suggestionsCount: r.data.suggestionsCount as number })
        onRefresh?.()
      } else {
        setError(r.error)
      }
    } catch (e: any) {
      setError(e.message)
    } finally { setExtracting(false) }
  }

  const completedFields = fields.filter(f => f.value?.trim()).length
  const requiredFields = fields.filter(f => f.isRequired)
  const missingRequired = requiredFields.filter(f => !f.value?.trim()).length
  const completionRate = fields.length > 0 ? Math.round((completedFields / fields.length) * 100) : 0

  return (
    <div className={cn("space-y-4", className)}>
      <div className="flex items-center gap-2">
        <BrainCircuit className="h-5 w-5 text-brand-600" />
        <span className="text-sm font-semibold text-surface-900">AI Compliance Copilot</span>
        <Badge variant="secondary" size="sm">Powered by AI</Badge>
      </div>

      <Separator />

      {/* Field Completion */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-surface-500">Field Completion</span>
          <span className="font-medium text-surface-700">{completedFields}/{fields.length}</span>
        </div>
        <Progress value={completionRate} size="sm" variant={completionRate >= 80 ? "success" : completionRate >= 50 ? "warning" : "danger"} />
      </div>

      {missingRequired > 0 && (
        <Alert variant="warning">
          <AlertTriangle className="h-4 w-4" />
          <span>{missingRequired} required field{missingRequired > 1 ? "s" : ""} missing</span>
        </Alert>
      )}

      {/* Extract Button */}
      <Button
        className="w-full"
        size="sm"
        onClick={runExtraction}
        loading={extracting}
        disabled={extracting}
      >
        {extracting ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Sparkles className="h-4 w-4" />
        )}
        {extracting ? "Analyzing..." : "Run AI Analysis"}
      </Button>

      {error && <p className="text-xs text-danger-600">{error}</p>}

      {result && (
        <div className="rounded-lg border border-brand-100 bg-brand-50 p-3 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-brand-800">
            <CheckCircle2 className="h-4 w-4" />
            Analysis Complete
          </div>
          <div className="space-y-1 text-xs text-brand-700">
            <div className="flex justify-between">
              <span>Confidence</span>
              <span className="font-semibold">{Math.round(result.overallConfidence * 100)}%</span>
            </div>
            <Progress value={Math.round(result.overallConfidence * 100)} size="sm" variant="default" />
            <p className="mt-1">{result.suggestionsCount} suggestion{result.suggestionsCount !== 1 ? "s" : ""} generated</p>
          </div>
        </div>
      )}

      <Separator />

      {/* Quick Actions */}
      <div className="space-y-1">
        <p className="text-xs font-medium text-surface-500 uppercase tracking-wider">Quick Actions</p>
        <button
          onClick={() => window.open(`/ai-copilot`, "_self")}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-surface-600 hover:bg-surface-100 transition-colors"
        >
          <FileSearch className="h-3.5 w-3.5" />
          View AI History
        </button>
        <button className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-surface-600 hover:bg-surface-100 transition-colors">
          <Lightbulb className="h-3.5 w-3.5" />
          View Recommendations
        </button>
        <Link
          href={`/documents/${documentId}/intelligence`}
          className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-surface-600 hover:bg-surface-100 transition-colors"
        >
          <BarChart3 className="h-3.5 w-3.5" />
          View Full Intelligence Report
        </Link>
      </div>
    </div>
  )
}
