import { waitForUploadCompletion, type CompletedUpload } from "./upload-client"

/** Staff supporting-document uploads share the staff status/completion routes. */
export function waitForSupportingDocumentUpload(attemptId: string): Promise<CompletedUpload> {
  return waitForUploadCompletion({
    statusUrl: `/api/uploads/${attemptId}/status`,
    completeUrl: `/api/uploads/${attemptId}/complete`,
  })
}

/** Portal request uploads use the portal-authenticated status/completion routes. */
export function waitForPortalUpload(attemptId: string): Promise<CompletedUpload> {
  return waitForUploadCompletion({
    statusUrl: `/api/portal-uploads/${attemptId}/status`,
    completeUrl: `/api/portal-uploads/${attemptId}/complete`,
  })
}
