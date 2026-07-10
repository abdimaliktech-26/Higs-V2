import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { FileText, HardDrive, Link2, Library } from "lucide-react"

const capabilities = [
  { icon: FileText, label: "Single File Upload", description: "Upload one PDF or document at a time" },
  { icon: HardDrive, label: "Private Local Storage", description: "Files are stored on the application server" },
  { icon: Link2, label: "Signed File Access", description: "Time-limited signed links for document access" },
  { icon: Library, label: "Document Library Destination", description: "Uploaded files land in the real Document Library" },
]

export function FileUploadCapabilityCard() {
  return (
    <Card>
      <CardHeader><CardTitle>File Upload Capability</CardTitle></CardHeader>
      <CardContent>
        <p className="mb-4 text-xs text-surface-400">CSV, Excel, ZIP upload, OCR, and batch processing are not supported today.</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {capabilities.map((c) => (
            <div key={c.label} className="flex items-start gap-2.5 rounded-lg border border-surface-100 p-3">
              <c.icon className="mt-0.5 h-4 w-4 shrink-0 text-success-500" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-surface-900">{c.label}</p>
                <p className="text-xs text-surface-400">{c.description}</p>
              </div>
              <Badge variant="success" size="sm" className="ml-auto shrink-0">Available</Badge>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
