import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { PDFRenderer } from "@/components/pdf/pdf-renderer"

export function DocumentPreviewCard({ pdfUrl }: { pdfUrl: string | null }) {
  return (
    <Card>
      <CardHeader><CardTitle>Document Preview</CardTitle></CardHeader>
      <CardContent className="p-0">
        {pdfUrl ? (
          <PDFRenderer url={pdfUrl} showToolbar />
        ) : (
          <div className="flex min-h-[400px] items-center justify-center text-sm text-surface-400">No file uploaded for this document yet</div>
        )}
      </CardContent>
    </Card>
  )
}
