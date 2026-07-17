export interface CompletedUpload {
  ownerId: string
  version?: number
}

export interface UploadClientRoutes {
  statusUrl: string
  completeUrl: string
}

const POLL_INTERVAL_MS = 2_000
const MAX_POLLS = 300

function pause(): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, POLL_INTERVAL_MS))
}

/** Polls only the uploader-scoped status route, then invokes server-side promotion/linkage. */
export async function waitForUploadCompletion(routes: UploadClientRoutes): Promise<CompletedUpload> {
  for (let poll = 0; poll < MAX_POLLS; poll += 1) {
    const statusResponse = await fetch(routes.statusUrl, { cache: "no-store" })
    const statusResult = await statusResponse.json()
    if (!statusResponse.ok || !statusResult.success) throw new Error(statusResult.error ?? "Unable to check upload status")
    const status = statusResult.data
    if (status.status === "FAILED") throw new Error("The upload did not pass secure processing.")
    if (status.status === "COMPLETED" && status.ownerId) return { ownerId: status.ownerId }
    if (status.status === "SCANNING" && status.malwareStatus === "CLEAN") {
      const completionResponse = await fetch(routes.completeUrl, { method: "POST" })
      const completionResult = await completionResponse.json()
      if (!completionResponse.ok || !completionResult.success) {
        throw new Error(completionResult.error ?? "Unable to complete upload")
      }
      if (completionResult.data.ownerId) {
        return { ownerId: completionResult.data.ownerId, version: completionResult.data.version }
      }
    }
    await pause()
  }
  throw new Error("Secure upload processing is taking longer than expected. You may safely return later.")
}
