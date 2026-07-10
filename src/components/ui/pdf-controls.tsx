"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { FileText, ZoomIn, ZoomOut, RotateCw, Download, Printer, ChevronLeft, ChevronRight, Maximize2 } from "lucide-react"

interface PDFToolbarProps {
  fileName?: string
  pageNumber?: number
  totalPages?: number
  onPageChange?: (page: number) => void
  onZoomIn?: () => void
  onZoomOut?: () => void
  onRotate?: () => void
  onDownload?: () => void
  onPrint?: () => void
  className?: string
}

export function PDFToolbar({
  fileName = "Document.pdf",
  pageNumber = 1,
  totalPages = 1,
  onPageChange,
  onZoomIn,
  onZoomOut,
  onRotate,
  onDownload,
  onPrint,
  className,
}: PDFToolbarProps) {
  return (
    <div className={cn(
      "flex items-center justify-between rounded-t-xl border border-surface-200 bg-white px-4 py-2",
      className
    )}>
      <div className="flex items-center gap-3 min-w-0">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-50">
          <FileText className="h-4 w-4 text-brand-600" />
        </div>
        <span className="text-sm font-medium text-surface-900 truncate">{fileName}</span>
      </div>

      <div className="flex items-center gap-1">
        <div className="flex items-center gap-1 rounded-lg bg-surface-100 p-0.5">
          <Button variant="ghost" size="icon-sm" onClick={onZoomOut} title="Zoom out">
            <ZoomOut className="h-4 w-4" />
          </Button>
          <span className="min-w-[3ch] text-center text-xs text-surface-600">100%</span>
          <Button variant="ghost" size="icon-sm" onClick={onZoomIn} title="Zoom in">
            <ZoomIn className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-1 rounded-lg bg-surface-100 p-0.5">
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange?.(pageNumber - 1)} disabled={pageNumber <= 1}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="min-w-[6ch] text-center text-xs text-surface-600">{pageNumber} / {totalPages}</span>
          <Button variant="ghost" size="icon-sm" onClick={() => onPageChange?.(pageNumber + 1)} disabled={pageNumber >= totalPages}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-0.5 border-l border-surface-200 pl-2 ml-1">
          <Button variant="ghost" size="icon-sm" onClick={onRotate} title="Rotate">
            <RotateCw className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDownload} title="Download">
            <Download className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onPrint} title="Print">
            <Printer className="h-4 w-4" />
          </Button>
          <Button variant="ghost" size="icon-sm" title="Fullscreen">
            <Maximize2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

interface PDFViewerPlaceholderProps {
  height?: number
  showToolbar?: boolean
  fileName?: string
  className?: string
}

export function PDFViewerPlaceholder({ height = 600, showToolbar = true, fileName, className }: PDFViewerPlaceholderProps) {
  return (
    <div className={cn("overflow-hidden rounded-xl border border-surface-200", className)}>
      {showToolbar && <PDFToolbar fileName={fileName} />}
      <div
        className="flex items-center justify-center bg-surface-50"
        style={{ height }}
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <FileText className="h-12 w-12 text-surface-300" />
          <div>
            <p className="text-sm font-medium text-surface-600">PDF Viewer</p>
            <p className="text-xs text-surface-400">PDF editing will be available in a future phase</p>
          </div>
        </div>
      </div>
    </div>
  )
}
