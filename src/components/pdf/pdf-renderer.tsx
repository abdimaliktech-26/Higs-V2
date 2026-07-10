"use client"

import { useRef, useEffect, useState, useCallback } from "react"
import * as pdfjsLib from "pdfjs-dist"
import { Button } from "@/components/ui/button"
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, RotateCw, FileText, AlertTriangle } from "lucide-react"

pdfjsLib.GlobalWorkerOptions.workerSrc = `//cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

interface PDFRendererProps {
  url: string
  onPageCount?: (count: number) => void
  onPageChange?: (page: number) => void
  onScaleChange?: (scale: number) => void
  pageNumber?: number
  scale?: number
  showToolbar?: boolean
  children?: React.ReactNode
  className?: string
}

export function PDFRenderer({
  url,
  onPageCount,
  onPageChange,
  onScaleChange,
  pageNumber,
  scale,
  showToolbar = true,
  children,
  className,
}: PDFRendererProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const onPageCountRef = useRef(onPageCount)
  const onPageChangeRef = useRef(onPageChange)
  const initialPageRef = useRef(pageNumber)
  const [pdfDoc, setPdfDoc] = useState<pdfjsLib.PDFDocumentProxy | null>(null)
  const [pageNum, setPageNum] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [internalScale, setInternalScale] = useState(1.5)
  const [rotation, setRotation] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const activePage = pageNumber ?? pageNum
  const activeScale = scale ?? internalScale

  useEffect(() => {
    onPageCountRef.current = onPageCount
    onPageChangeRef.current = onPageChange
    initialPageRef.current = pageNumber
  }, [onPageCount, onPageChange, pageNumber])

  const renderPage = useCallback(async (doc: pdfjsLib.PDFDocumentProxy, num: number, s: number, rot: number) => {
    if (!canvasRef.current) return
    const page = await doc.getPage(num)
    const viewport = page.getViewport({ scale: s, rotation: rot })
    const canvas = canvasRef.current
    canvas.height = viewport.height
    canvas.width = viewport.width
    await page.render({ canvas, viewport }).promise
  }, [])

  // Load PDF
  useEffect(() => {
    let cancelled = false

    function startLoad() {
      setLoading(true)
      setError(null)
    }
    startLoad()

    pdfjsLib.getDocument({ url }).promise.then((doc) => {
      if (cancelled) return
      setPdfDoc(doc)
      setTotalPages(doc.numPages)
      const initialPage = initialPageRef.current ?? 1
      setPageNum(initialPage)
      setLoading(false)
      onPageCountRef.current?.(doc.numPages)
      onPageChangeRef.current?.(initialPage)
    }).catch((err) => {
      if (cancelled) return
      setError(err.message || "Failed to load PDF")
      setLoading(false)
    })

    return () => { cancelled = true }
  }, [url])

  // Re-render on page/scale/rotation change
  useEffect(() => {
    if (!pdfDoc) return
    renderPage(pdfDoc, activePage, activeScale, rotation)
  }, [pdfDoc, activePage, activeScale, rotation, renderPage])

  function goToPage(n: number) {
    if (!pdfDoc || n < 1 || n > totalPages) return
    setPageNum(n)
    onPageChange?.(n)
  }

  const zoomLevels = [0.75, 1, 1.25, 1.5, 2, 2.5, 3]
  const zoomIdx = zoomLevels.indexOf(activeScale)
  const currentZoom = `${Math.round(activeScale * 100)}%`
  const changeScale = (nextScale: number) => {
    setInternalScale(nextScale)
    onScaleChange?.(nextScale)
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center bg-surface-50 rounded-xl border border-surface-200 min-h-[600px]">
        <AlertTriangle className="mb-3 h-10 w-10 text-warning-500" />
        <p className="text-sm font-medium text-surface-700">Could not load PDF</p>
        <p className="text-xs text-surface-500 mt-1">{error}</p>
      </div>
    )
  }

  return (
    <div className={className}>
      {/* PDF Toolbar */}
      {showToolbar && (
        <div className="flex items-center justify-between rounded-t-xl border-x border-t border-surface-200 bg-white px-4 py-2">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => goToPage(activePage - 1)} disabled={activePage <= 1 || loading}>
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="min-w-[6ch] text-center text-xs text-surface-600">
              {loading ? "..." : `${activePage} / ${totalPages}`}
            </span>
            <Button variant="ghost" size="icon-sm" onClick={() => goToPage(activePage + 1)} disabled={activePage >= totalPages || loading}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon-sm" onClick={() => { const i = Math.max(0, zoomIdx - 1); changeScale(zoomLevels[i]) }} disabled={zoomIdx <= 0 || loading}>
              <ZoomOut className="h-4 w-4" />
            </Button>
            <span className="min-w-[4ch] text-center text-xs text-surface-600">{loading ? "..." : currentZoom}</span>
            <Button variant="ghost" size="icon-sm" onClick={() => { const i = Math.min(zoomLevels.length - 1, zoomIdx + 1); changeScale(zoomLevels[i]) }} disabled={zoomIdx >= zoomLevels.length - 1 || loading}>
              <ZoomIn className="h-4 w-4" />
            </Button>
            <div className="w-px h-5 bg-surface-200 mx-1" />
            <Button variant="ghost" size="icon-sm" onClick={() => setRotation((r) => (r + 90) % 360)} disabled={loading}>
              <RotateCw className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {/* PDF Canvas */}
      <div
        ref={containerRef}
        className="relative flex items-start justify-center overflow-auto bg-surface-100"
        style={{ minHeight: 640, maxHeight: "calc(100vh - 320px)" }}
      >
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-surface-50/80">
            <div className="flex flex-col items-center gap-2">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-200 border-t-brand-600" />
              <p className="text-sm text-surface-500">Loading PDF...</p>
            </div>
          </div>
        )}

        {totalPages === 0 && !loading && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-center w-full">
            <FileText className="mb-3 h-12 w-12 text-surface-300" />
            <p className="text-sm font-medium text-surface-600">No PDF to display</p>
            <p className="text-xs text-surface-400 mt-1">Upload or select a document to begin</p>
          </div>
        )}

        <div className="relative inline-block px-12 py-10" style={{ display: totalPages > 0 ? "inline-block" : "none" }}>
          <canvas ref={canvasRef} className="rounded-sm bg-white shadow-xl shadow-surface-300/50 ring-1 ring-surface-200" />
          {/* Field overlay area - children are positioned absolutely */}
          {children}
        </div>
      </div>
    </div>
  )
}
