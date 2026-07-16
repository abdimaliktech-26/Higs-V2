import { UploadStatus, type UploadAttempt } from "@prisma/client"

export interface StaffUploadStatusResponse {
  attemptId: string
  uploadKind: UploadAttempt["uploadKind"]
  status: UploadAttempt["status"]
  malwareStatus: UploadAttempt["malwareStatus"]
  cleanupStatus: UploadAttempt["cleanupStatus"]
  failureStage?: NonNullable<UploadAttempt["failureStage"]>
  failureCategory?: NonNullable<UploadAttempt["failureCategory"]>
  terminal: boolean
  ownerId?: string
  updatedAt: Date
}

export function toStaffUploadStatusResponse(attempt: UploadAttempt): StaffUploadStatusResponse {
  const terminal = attempt.status === UploadStatus.COMPLETED || attempt.status === UploadStatus.FAILED
  return {
    attemptId: attempt.id,
    uploadKind: attempt.uploadKind,
    status: attempt.status,
    malwareStatus: attempt.malwareStatus,
    cleanupStatus: attempt.cleanupStatus,
    failureStage: attempt.failureStage ?? undefined,
    failureCategory: attempt.failureCategory ?? undefined,
    terminal,
    ownerId: attempt.status === UploadStatus.COMPLETED ? attempt.intendedOwnerId : undefined,
    updatedAt: attempt.updatedAt,
  }
}
