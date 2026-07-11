"use client"

import { useState, useRef } from "react"
import { useRouter } from "next/navigation"
import { Button } from "@/components/ui/button"
import { Modal } from "@/components/ui/modal"
import { Alert } from "@/components/ui/alert"
import { FilePlus2, Upload } from "lucide-react"

interface Props {
  templateId: string
  templateName: string
  currentVersion: number
}

export function TemplateVersionUpload({ templateId, templateName, currentVersion }: Props) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  function close() {
    setOpen(false)
    setFile(null)
    setError(null)
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    if (!file) { setError("Select a PDF file to upload"); return }
    setLoading(true); setError(null)

    const form = new FormData()
    form.set("file", file)

    const res = await fetch(`/api/templates/${templateId}/versions`, { method: "POST", body: form })
    const result = await res.json()

    setLoading(false)
    if (result.success) {
      close()
      router.refresh()
    } else {
      setError(result.error)
    }
  }

  return (
    <>
      <Button variant="ghost" size="icon-sm" type="button" title="Upload new version" onClick={() => setOpen(true)}>
        <FilePlus2 className="h-4 w-4" />
      </Button>
      <Modal
        open={open}
        onClose={close}
        title="Upload New Version"
        description={`Creates version ${currentVersion + 1} of "${templateName}". The current version's file stays untouched and downloadable.`}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && <Alert variant="error">{error}</Alert>}
          <div className="rounded-lg border-2 border-dashed border-surface-300 p-6 text-center">
            <Upload className="mx-auto mb-2 h-6 w-6 text-surface-400" />
            <p className="text-sm font-medium text-surface-600">{file ? file.name : "Choose a PDF file"}</p>
            <p className="mt-1 text-xs text-surface-400">PDF only, up to 25 MB.</p>
            <input
              ref={fileInputRef}
              type="file"
              accept=".pdf,application/pdf"
              className="hidden"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button type="button" variant="secondary" size="sm" className="mt-3" onClick={() => fileInputRef.current?.click()}>
              Browse Files
            </Button>
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={close}>Cancel</Button>
            <Button type="submit" loading={loading}>Create Version {currentVersion + 1}</Button>
          </div>
        </form>
      </Modal>
    </>
  )
}
