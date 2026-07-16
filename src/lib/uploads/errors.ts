import type { UploadFailureCategory } from "@prisma/client"

export type UploadErrorCode =
  | "INVALID_ACTOR"
  | "INVALID_IDEMPOTENCY_KEY"
  | "INVALID_IDENTIFIER"
  | "INVALID_TRANSITION"
  | "SIZE_LIMIT"
  | "SIZE_MISMATCH"
  | "TYPE_MISMATCH"
  | "MALFORMED_CONTENT"
  | "ENCRYPTED_PDF"
  | "ACTIVE_CONTENT"
  | "SCAN_UNAVAILABLE"
  | "INTEGRITY_MISMATCH"
  | "PROMOTION_NOT_VERIFIED"
  | "CONFLICT"

export class UploadLifecycleError extends Error {
  readonly code: UploadErrorCode
  readonly failureCategory?: UploadFailureCategory

  constructor(code: UploadErrorCode, message: string, failureCategory?: UploadFailureCategory) {
    super(message)
    this.name = "UploadLifecycleError"
    this.code = code
    this.failureCategory = failureCategory
  }
}

export class UploadValidationError extends UploadLifecycleError {
  readonly safeDiagnostic?: string

  constructor(
    code: Extract<UploadErrorCode, "SIZE_LIMIT" | "SIZE_MISMATCH" | "TYPE_MISMATCH" | "MALFORMED_CONTENT" | "ENCRYPTED_PDF" | "ACTIVE_CONTENT">,
    message: string,
    failureCategory: UploadFailureCategory,
    safeDiagnostic?: string,
  ) {
    super(code, message, failureCategory)
    this.name = "UploadValidationError"
    this.safeDiagnostic = safeDiagnostic
  }
}

export type UploadScanEventErrorCode =
  | "INVALID_EVENT"
  | "UNTRUSTED_EVENT"
  | "ATTEMPT_NOT_READY"
  | "EVENT_CONFLICT"

export class UploadScanEventError extends Error {
  readonly code: UploadScanEventErrorCode
  readonly retryable: boolean

  constructor(code: UploadScanEventErrorCode, message: string, retryable = false) {
    super(message)
    this.name = "UploadScanEventError"
    this.code = code
    this.retryable = retryable
  }
}
