"use client"

import { cn } from "@/lib/utils"
import { Badge } from "@/components/ui/badge"
import { CheckCircle, Circle } from "lucide-react"

type FieldOverlay = {
  id: string
  name: string
  fieldType: string
  value: string | null
  pageNumber: number
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  isRequired: boolean
  confidence: number | null
}

interface FieldOverlayProps {
  fields: FieldOverlay[]
  currentPage: number
  scale: number
  onFieldClick?: (fieldId: string) => void
  selectedFieldId?: string | null
  className?: string
}

export function FieldOverlays({ fields, currentPage, scale, onFieldClick, selectedFieldId, className }: FieldOverlayProps) {
  const pageFields = fields.filter((f) => f.pageNumber === currentPage)

  if (pageFields.length === 0) return null

  return (
    <div className={cn("absolute inset-0 pointer-events-none", className)}>
      {pageFields.map((field) => {
        const hasValue = !!field.value && field.value.trim().length > 0
        const isSelected = field.id === selectedFieldId

        // Default position spread if no coords stored
        const idx = pageFields.indexOf(field)
        const defaultX = 40 + (idx % 3) * 250
        const defaultY = 30 + Math.floor(idx / 3) * 80

        const x = field.posX !== null ? field.posX * (scale / 1.5) : defaultX
        const y = field.posY !== null ? field.posY * (scale / 1.5) : defaultY

        return (
          <button
            key={field.id}
            type="button"
            onClick={() => onFieldClick?.(field.id)}
            className={cn(
              "pointer-events-auto absolute flex items-center gap-2 rounded-md border bg-white/95 px-3 py-1.5 text-left shadow-sm transition-all",
              "hover:shadow-md hover:border-brand-300",
              isSelected && "ring-2 ring-brand-500 border-brand-500",
              hasValue ? "border-success-300" : "border-warning-300 bg-warning-50/90"
            )}
            style={{
              left: x,
              top: y,
              minWidth: 180,
              maxWidth: 260,
            }}
            title={`${field.name} (${field.fieldType})`}
          >
            {hasValue ? (
              <CheckCircle className="h-3.5 w-3.5 text-success-500 shrink-0" />
            ) : (
              <Circle className="h-3.5 w-3.5 text-warning-400 shrink-0" />
            )}
            <span className="text-xs font-medium text-surface-800 truncate flex-1">{field.name}</span>
            {field.isRequired && <span className="text-[10px] text-danger-500">*</span>}
          </button>
        )
      })}
    </div>
  )
}
