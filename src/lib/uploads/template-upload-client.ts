import { waitForUploadCompletion } from "./upload-client"

export interface CompletedTemplateUpload {
  templateId: string
  version?: number
}

/** Polls only the uploader-scoped status route, then invokes server-side promotion/linkage. */
export async function waitForTemplateUpload(attemptId: string): Promise<CompletedTemplateUpload> {
  const completed = await waitForUploadCompletion({
    statusUrl: `/api/uploads/${attemptId}/status`,
    completeUrl: `/api/uploads/${attemptId}/complete`,
  })
  return { templateId: completed.ownerId, version: completed.version }
}
