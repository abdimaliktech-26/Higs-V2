"use client"

import { useState } from "react"
import { cn } from "@/lib/utils"

export interface TemplateFieldBox {
  id: string
  fieldKey: string
  name: string
  fieldType: string
  pageNumber: number
  posX: number | null
  posY: number | null
  width: number | null
  height: number | null
  isRequired: boolean
  sortOrder: number
}

interface Props {
  fields: TemplateFieldBox[]
  currentPage: number
  scale: number
  selectedFieldId: string | null
  isReadOnly: boolean
  onSelect: (id: string) => void
  onGeometryChange: (id: string, geometry: { posX: number; posY: number; width: number; height: number }) => void
}

// Storage coordinates are pixels on the PDF canvas rendered at this base
// scale — the exact same convention already used by PdfField/FieldOverlays
// (src/components/pdf/field-overlays.tsx: `x = field.posX * (scale / 1.5)`).
// No second coordinate convention is introduced here.
const BASE_SCALE = 1.5
export const DEFAULT_FIELD_WIDTH = 180
export const DEFAULT_FIELD_HEIGHT = 32

export function TemplateFieldOverlay({ fields, currentPage, scale, selectedFieldId, isReadOnly, onSelect, onGeometryChange }: Props) {
  const pageFields = fields.filter((f) => f.pageNumber === currentPage)
  const factor = scale / BASE_SCALE
  const [liveGeometry, setLiveGeometry] = useState<Record<string, { x: number; y: number; w: number; h: number }>>({})

  function startDrag(e: React.PointerEvent, field: TemplateFieldBox, mode: "move" | "resize") {
    if (isReadOnly) return
    e.stopPropagation()
    e.preventDefault()
    onSelect(field.id)

    const baseX = field.posX ?? 40
    const baseY = field.posY ?? 30
    const baseW = field.width ?? DEFAULT_FIELD_WIDTH
    const baseH = field.height ?? DEFAULT_FIELD_HEIGHT
    const startClientX = e.clientX
    const startClientY = e.clientY

    function onMove(ev: PointerEvent) {
      const dx = (ev.clientX - startClientX) / factor
      const dy = (ev.clientY - startClientY) / factor
      if (mode === "move") {
        setLiveGeometry((prev) => ({ ...prev, [field.id]: { x: Math.max(0, baseX + dx), y: Math.max(0, baseY + dy), w: baseW, h: baseH } }))
      } else {
        setLiveGeometry((prev) => ({ ...prev, [field.id]: { x: baseX, y: baseY, w: Math.max(20, baseW + dx), h: Math.max(16, baseH + dy) } }))
      }
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove)
      window.removeEventListener("pointerup", onUp)
      setLiveGeometry((prev) => {
        const geom = prev[field.id]
        if (geom) onGeometryChange(field.id, { posX: Math.round(geom.x), posY: Math.round(geom.y), width: Math.round(geom.w), height: Math.round(geom.h) })
        return prev
      })
    }
    window.addEventListener("pointermove", onMove)
    window.addEventListener("pointerup", onUp)
  }

  if (pageFields.length === 0) return null

  return (
    <div className="absolute inset-0" style={{ pointerEvents: isReadOnly ? "none" : "auto" }}>
      {pageFields.map((field) => {
        const live = liveGeometry[field.id]
        const x = (live?.x ?? field.posX ?? 40) * factor
        const y = (live?.y ?? field.posY ?? 30) * factor
        const w = (live?.w ?? field.width ?? DEFAULT_FIELD_WIDTH) * factor
        const h = (live?.h ?? field.height ?? DEFAULT_FIELD_HEIGHT) * factor
        const selected = field.id === selectedFieldId

        return (
          <div
            key={field.id}
            onPointerDown={(e) => startDrag(e, field, "move")}
            className={cn(
              "absolute flex items-center gap-1 rounded-md border-2 bg-brand-50/80 px-2 text-xs font-medium text-brand-800 shadow-sm",
              isReadOnly ? "cursor-default" : "cursor-move",
              selected ? "border-brand-600 ring-2 ring-brand-300" : "border-brand-300"
            )}
            style={{ left: x, top: y, width: w, height: h }}
            title={`${field.name} (${field.fieldType})`}
          >
            <span className="min-w-0 flex-1 truncate">{field.name}</span>
            {field.isRequired && <span className="shrink-0 text-danger-500">*</span>}
            {!isReadOnly && (
              <div
                onPointerDown={(e) => startDrag(e, field, "resize")}
                className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border border-white bg-brand-600"
                title="Drag to resize"
              />
            )}
          </div>
        )
      })}
    </div>
  )
}
