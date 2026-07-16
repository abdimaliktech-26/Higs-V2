export interface CompletedTemplateUpload {
  templateId: string
  version?: number
}

const POLL_INTERVAL_MS = 2_000
const MAX_POLLS = 300

function pause(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS))
}

/** Polls only the uploader-scoped status route, then invokes server-side promotion/linkage. */
export async function waitForTemplateUpload(attemptId: string): Promise<CompletedTemplateUpload> {
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const statusResponse = await fetch(`/api/uploads/${attemptId}/status`, { cache: "no-store" })
    const statusResult = await statusResponse.json()
    if (!statusResponse.ok || !statusResult.success) throw new Error(statusResult.error ?? "Unable to check upload status")
    const status = statusResult.data
    if (status.status === "FAILED") throw new Error("The template upload did not pass secure processing.")
    if (status.status === "COMPLETED" && status.ownerId) return { templateId: status.ownerId }
    if (status.status === "SCANNING" && status.malwareStatus === "CLEAN") {
      const completionResponse = await fetch(`/api/uploads/${attemptId}/complete`, { method: "POST" })
      const completionResult = await completionResponse.json()
      if (!completionResponse.ok || !completionResult.success) {
        throw new Error(completionResult.error ?? "Unable to complete template upload")
      }
      if (completionResult.data.templateId) {
        return { templateId: completionResult.data.templateId, version: completionResult.data.version }
      }
    }
    await pause()
  }
  throw new Error("Secure upload processing is taking longer than expected. You may safely return later.")
}
