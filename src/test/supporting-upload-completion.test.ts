// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const findAttemptMock = vi.fn()
const findAttemptOrThrowMock = vi.fn()
const transactionMock = vi.fn()
const promoteMock = vi.fn()
const cleanupMock = vi.fn()
const beginLinkingMock = vi.fn()
const markFailedMock = vi.fn()
const storeStreamMock = vi.fn()
const notifyMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    uploadAttempt: {
      findUnique: (...a: unknown[]) => findAttemptMock(...a),
      findUniqueOrThrow: (...a: unknown[]) => findAttemptOrThrowMock(...a),
    },
    $transaction: (cb: unknown) => transactionMock(cb),
  },
}))
vi.mock("@/lib/uploads/promotion", () => ({
  promoteVerifiedCleanUpload: (...a: unknown[]) => promoteMock(...a),
  finishQuarantineCleanup: (...a: unknown[]) => cleanupMock(...a),
}))
vi.mock("@/lib/uploads/lifecycle", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uploads/lifecycle")>()
  return {
    ...actual,
    beginLinking: (...a: unknown[]) => beginLinkingMock(...a),
    markUploadFailed: (...a: unknown[]) => markFailedMock(...a),
  }
})
vi.mock("@/lib/storage", () => ({ storeFileFromStream: (...a: unknown[]) => storeStreamMock(...a) }))
vi.mock("@/lib/portal/notifications", () => ({ notifySinglePortalUser: (...a: unknown[]) => notifyMock(...a) }))

import { completePortalUpload, completeStaffSupportingUpload } from "@/lib/uploads/supporting-upload"

const ATTEMPT_ID = "cm42345678901234567890123"
const ORG_ID = "cm12345678901234567890123"
const STAFF_ID = "cm22345678901234567890123"
const PORTAL_USER_ID = "cm52345678901234567890123"
const CLIENT_ID = "cm32345678901234567890123"
const REQUEST_ID = "cm62345678901234567890123"
const DOC_ID = "b2345678-1234-4234-9234-123456789abc"
const ARTIFACT_ID = "c2345678-1234-4234-9234-123456789abc"
const STORED_OBJECT_ID = "cm72345678901234567890123"

function validEnvironment() {
  vi.stubEnv("STORAGE_PROVIDER", "s3")
  vi.stubEnv("AWS_REGION", "us-east-2")
  vi.stubEnv("S3_DURABLE_BUCKET", "higsi-durable-prod")
  vi.stubEnv("S3_QUARANTINE_BUCKET", "higsi-quarantine-prod")
  vi.stubEnv("S3_KMS_KEY_ARN", "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111")
  vi.stubEnv("S3_SIGNED_URL_TTL_SECONDS", "60")
  vi.stubEnv("MALWARE_SCANNER_PROVIDER", "guardduty-s3")
  vi.stubEnv("GUARDDUTY_EXPECTED_AWS_ACCOUNT_ID", "123456789012")
  vi.stubEnv("GUARDDUTY_EXPECTED_REGION", "us-east-2")
  vi.stubEnv("GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN", "arn:aws:guardduty:us-east-2:123456789012:malware-protection-plan/opaque123")
  vi.stubEnv("GUARDDUTY_SCAN_QUEUE_URL", "https://sqs.us-east-2.amazonaws.com/123456789012/higsi-scan-results")
  vi.stubEnv("MALWARE_SCANNER_OPERATIONALLY_APPROVED", "true")
  vi.stubEnv("UPLOAD_PLATFORM_LIMITS_VERIFIED", "true")
}

function staffAttempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    organizationId: ORG_ID,
    actorType: "STAFF",
    staffUserId: STAFF_ID,
    portalUserId: null,
    uploadKind: "STAFF_SUPPORTING",
    intendedOwnerId: DOC_ID,
    artifactId: ARTIFACT_ID,
    status: "SCANNING",
    malwareStatus: "CLEAN",
    validatedMimeType: "application/pdf",
    quarantineObjectKey: `organizations/${ORG_ID}/uploads/${ATTEMPT_ID}/${ARTIFACT_ID}`,
    quarantineObjectVersionId: "qv1",
    checksumSha256: "a".repeat(64),
    actualSizeBytes: BigInt(100),
    plannedDurableObjectKey: `organizations/${ORG_ID}/supporting/${DOC_ID}/${ARTIFACT_ID}`,
    ...overrides,
  }
}

function portalAttempt(overrides: Record<string, unknown> = {}) {
  return staffAttempt({
    actorType: "PORTAL",
    staffUserId: null,
    portalUserId: PORTAL_USER_ID,
    uploadKind: "PORTAL_REQUEST",
    validatedMimeType: "image/jpeg",
    supportingIntent: portalIntent(),
    ...overrides,
  })
}

function staffIntent(overrides: Record<string, unknown> = {}) {
  return {
    id: "intent-1",
    organizationId: ORG_ID,
    uploadAttemptId: ATTEMPT_ID,
    supportingDocumentId: DOC_ID,
    clientId: CLIENT_ID,
    packetId: null,
    portalRequestId: null,
    title: "Care plan",
    category: "assessment",
    description: "Quarterly assessment",
    originalFileName: null,
    ...overrides,
  }
}

function portalIntent(overrides: Record<string, unknown> = {}) {
  return staffIntent({
    title: null,
    category: null,
    description: null,
    portalRequestId: REQUEST_ID,
    originalFileName: "insurance.jpg",
    ...overrides,
  })
}

function pendingRequest(overrides: Record<string, unknown> = {}) {
  return {
    id: REQUEST_ID,
    organizationId: ORG_ID,
    clientId: CLIENT_ID,
    packetId: null,
    title: "Insurance Card",
    category: "INSURANCE",
    status: "PENDING",
    ...overrides,
  }
}

interface FakeTx {
  uploadAttempt: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
  supportingDocument: { create: ReturnType<typeof vi.fn> }
  storedObject: { updateMany: ReturnType<typeof vi.fn> }
  portalDocumentRequest: { findUnique: ReturnType<typeof vi.fn>; updateMany: ReturnType<typeof vi.fn> }
  portalDocumentTimelineEvent: { create: ReturnType<typeof vi.fn> }
  auditEvent: { create: ReturnType<typeof vi.fn> }
  portalAuditEvent: { create: ReturnType<typeof vi.fn> }
}

function makeTx(attemptInTx: Record<string, unknown>): FakeTx {
  return {
    uploadAttempt: {
      findUnique: vi.fn().mockResolvedValue(attemptInTx),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    supportingDocument: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ ...data })) },
    storedObject: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    portalDocumentRequest: {
      findUnique: vi.fn().mockResolvedValue(pendingRequest()),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    portalDocumentTimelineEvent: { create: vi.fn().mockResolvedValue({ id: "event-1" }) },
    auditEvent: { create: vi.fn().mockResolvedValue({ id: "audit-1" }) },
    portalAuditEvent: { create: vi.fn().mockResolvedValue({ id: "portal-audit-1" }) },
  }
}

const promotedMetadata = {
  provider: "s3",
  bucket: "higsi-durable-prod",
  key: `organizations/${ORG_ID}/supporting/${DOC_ID}/${ARTIFACT_ID}`,
  location: "durable",
  versionId: "dv1",
  etag: "etag",
  checksumSha256: "a".repeat(64),
  size: 100,
  mimeType: "application/pdf",
  encryptionKeyReference: "arn:aws:kms:us-east-2:123456789012:key/11111111-1111-4111-8111-111111111111",
  lastModified: new Date(),
  metadata: {},
}

const fakeAdapter = {
  provider: "s3",
  getObjectStream: vi.fn().mockResolvedValue({ stream: "durable-stream", metadata: promotedMetadata }),
} as never

let currentTx: FakeTx

beforeEach(() => {
  vi.clearAllMocks()
  validEnvironment()
  promoteMock.mockImplementation(async (attempt: Record<string, unknown>, mimeType: string) => ({
    attempt,
    promoted: { ...promotedMetadata, mimeType },
  }))
  cleanupMock.mockResolvedValue(undefined)
  beginLinkingMock.mockResolvedValue(undefined)
  markFailedMock.mockResolvedValue(undefined)
  storeStreamMock.mockResolvedValue({ key: "compat-key", url: "/api/files/compat-key", size: 100 })
  notifyMock.mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllEnvs())

describe("staff supporting upload completion", () => {
  function arrangeStaff(attemptInTxOverrides: Record<string, unknown> = {}) {
    const attempt = staffAttempt()
    findAttemptMock.mockResolvedValue(attempt)
    findAttemptOrThrowMock.mockResolvedValue(staffAttempt({ status: "LINKED_CLEANUP_PENDING" }))
    currentTx = makeTx({
      ...staffAttempt({ status: "LINKING" }),
      supportingIntent: staffIntent(),
      storedObject: { id: STORED_OBJECT_ID, lifecycleStatus: "PENDING" },
      ...attemptInTxOverrides,
    })
    transactionMock.mockImplementation((cb: (tx: FakeTx) => unknown) => cb(currentTx))
    return attempt
  }

  it("links the intent-defined SupportingDocument, stored object, audit, and attempt in one transaction", async () => {
    arrangeStaff()
    const result = await completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)

    expect(promoteMock).toHaveBeenCalledWith(expect.objectContaining({ id: ATTEMPT_ID }), "application/pdf", fakeAdapter)
    const createData = currentTx.supportingDocument.create.mock.calls[0][0].data
    expect(createData).toEqual(expect.objectContaining({
      id: DOC_ID,
      organizationId: ORG_ID,
      title: "Care plan",
      category: "assessment",
      description: "Quarterly assessment",
      clientId: CLIENT_ID,
      packetId: null,
      fileKey: "compat-key",
      fileUrl: "/api/files/compat-key",
      fileSize: 100,
      mimeType: "application/pdf",
      uploadedById: STAFF_ID,
      storedObjectId: STORED_OBJECT_ID,
    }))
    expect(currentTx.storedObject.updateMany).toHaveBeenCalledWith({
      where: { id: STORED_OBJECT_ID, lifecycleStatus: "PENDING" },
      data: { lifecycleStatus: "AVAILABLE" },
    })
    const auditData = currentTx.auditEvent.create.mock.calls[0][0].data
    expect(auditData.action).toBe("DOCUMENT_UPLOADED")
    expect(auditData.targetType).toBe("SUPPORTING_DOCUMENT")
    expect(auditData.targetId).toBe(DOC_ID)
    expect(currentTx.uploadAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: ATTEMPT_ID, status: "LINKING" },
    }))
    expect(cleanupMock).toHaveBeenCalled()
    expect(result).toEqual({ attemptId: ATTEMPT_ID, status: "COMPLETED", supportingDocumentId: DOC_ID })
  })

  it("stores the compatibility copy under an opaque artifact key, never the original filename", async () => {
    arrangeStaff()
    await completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)
    const [compatKey] = storeStreamMock.mock.calls[0]
    expect(compatKey).toBe(`supporting/${ORG_ID}/${ARTIFACT_ID}.pdf`)
  })

  it("rolls the transaction back and fails the attempt when strict audit cannot be written", async () => {
    arrangeStaff()
    currentTx.auditEvent.create.mockRejectedValue(new Error("audit outage"))
    transactionMock.mockImplementation(async (cb: (tx: FakeTx) => unknown) => {
      // A real transaction rolls back every earlier write when the callback rejects.
      return cb(currentTx)
    })
    await expect(completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)).rejects.toThrow("audit outage")
    expect(markFailedMock).toHaveBeenCalledWith(ATTEMPT_ID, "LINKING", "LINKAGE", "DATABASE_FAILURE", expect.any(Date))
    expect(cleanupMock).not.toHaveBeenCalled()
  })

  it("refuses completion when the verified scan is not clean", async () => {
    findAttemptMock.mockResolvedValue(staffAttempt({ malwareStatus: "PENDING" }))
    await expect(completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)).rejects.toThrow(/scan is not complete/i)
    expect(promoteMock).not.toHaveBeenCalled()
  })

  it("refuses completion without a persisted validated MIME type", async () => {
    findAttemptMock.mockResolvedValue(staffAttempt({ validatedMimeType: null }))
    await expect(completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)).rejects.toThrow(/validated upload type/i)
    expect(promoteMock).not.toHaveBeenCalled()
  })

  it("hides attempts belonging to another staff user", async () => {
    findAttemptMock.mockResolvedValue(staffAttempt({ staffUserId: "cm99345678901234567890123" }))
    await expect(completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)).rejects.toThrow(/not found/i)
  })

  it("resumes only quarantine cleanup for an already linked attempt", async () => {
    findAttemptMock.mockResolvedValue(staffAttempt({ status: "LINKED_CLEANUP_PENDING" }))
    findAttemptOrThrowMock.mockResolvedValue(staffAttempt({ status: "LINKED_CLEANUP_PENDING" }))
    const result = await completeStaffSupportingUpload(ATTEMPT_ID, STAFF_ID, fakeAdapter)
    expect(promoteMock).not.toHaveBeenCalled()
    expect(cleanupMock).toHaveBeenCalled()
    expect(result.status).toBe("COMPLETED")
    expect(result.supportingDocumentId).toBe(DOC_ID)
  })
})

describe("portal upload completion", () => {
  function arrangePortal(txOverrides: Record<string, unknown> = {}) {
    findAttemptMock.mockResolvedValue(portalAttempt())
    findAttemptOrThrowMock.mockResolvedValue(portalAttempt({ status: "LINKED_CLEANUP_PENDING" }))
    currentTx = makeTx({
      ...portalAttempt({ status: "LINKING" }),
      storedObject: { id: STORED_OBJECT_ID, lifecycleStatus: "PENDING" },
      ...txOverrides,
    })
    transactionMock.mockImplementation((cb: (tx: FakeTx) => unknown) => cb(currentTx))
  }

  it("preserves the legacy portal workflow inside the completion transaction", async () => {
    arrangePortal()
    const result = await completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)

    // Race-safe request transition, exactly as the legacy synchronous route.
    expect(currentTx.portalDocumentRequest.updateMany).toHaveBeenCalledWith({
      where: { id: REQUEST_ID, status: { in: ["PENDING", "NEEDS_REPLACEMENT"] } },
      data: { status: "SUBMITTED" },
    })
    const createData = currentTx.supportingDocument.create.mock.calls[0][0].data
    expect(createData).toEqual(expect.objectContaining({
      id: DOC_ID,
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      title: "Insurance Card",
      category: "insurance",
      originalFileName: "insurance.jpg",
      portalRequestId: REQUEST_ID,
      uploadedByPortalUserId: PORTAL_USER_ID,
      status: "active",
      reviewStatus: "PENDING_REVIEW",
      mimeType: "image/jpeg",
      storedObjectId: STORED_OBJECT_ID,
    }))
    const eventData = currentTx.portalDocumentTimelineEvent.create.mock.calls[0][0].data
    expect(eventData).toEqual({
      requestId: REQUEST_ID,
      eventType: "UPLOADED",
      supportingDocumentId: DOC_ID,
      createdByPortalUserId: PORTAL_USER_ID,
    })
    const auditData = currentTx.portalAuditEvent.create.mock.calls[0][0].data
    expect(auditData.action).toBe("PORTAL_DOCUMENT_UPLOADED")
    expect(auditData.portalUserId).toBe(PORTAL_USER_ID)
    expect(auditData.clientId).toBe(CLIENT_ID)
    expect(JSON.stringify(auditData)).not.toContain("Insurance Card")
    const [notifiedUser, notifyInput, txArg] = notifyMock.mock.calls[0]
    expect(notifiedUser).toBe(PORTAL_USER_ID)
    expect(notifyInput.type).toBe("upload_received")
    expect(notifyInput.link).toBe(`/portal/upload?client=${CLIENT_ID}&request=${REQUEST_ID}`)
    expect(txArg).toBe(currentTx)
    expect(result.status).toBe("COMPLETED")
  })

  it("writes a RESUBMITTED timeline event when completing against NEEDS_REPLACEMENT", async () => {
    arrangePortal()
    currentTx.portalDocumentRequest.findUnique.mockResolvedValue(pendingRequest({ status: "NEEDS_REPLACEMENT" }))
    await completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)
    expect(currentTx.portalDocumentTimelineEvent.create.mock.calls[0][0].data.eventType).toBe("RESUBMITTED")
    expect(currentTx.supportingDocument.create.mock.calls[0][0].data.reviewStatus).toBe("PENDING_REVIEW")
  })

  it("returns a bounded conflict when the request was cancelled during scanning", async () => {
    arrangePortal()
    currentTx.portalDocumentRequest.findUnique.mockResolvedValue(pendingRequest({ status: "CANCELLED" }))
    await expect(completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)).rejects.toThrow(/cannot accept an upload/i)
    expect(currentTx.supportingDocument.create).not.toHaveBeenCalled()
    expect(currentTx.portalDocumentRequest.updateMany).not.toHaveBeenCalled()
    expect(markFailedMock).toHaveBeenCalledWith(ATTEMPT_ID, "LINKING", "LINKAGE", "CONFLICT", expect.any(Date))
  })

  it("aborts on a concurrent double-completion race without duplicate documents or events", async () => {
    arrangePortal()
    currentTx.portalDocumentRequest.updateMany.mockResolvedValue({ count: 0 })
    await expect(completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)).rejects.toThrow(/cannot accept an upload/i)
    expect(currentTx.supportingDocument.create).not.toHaveBeenCalled()
    expect(currentTx.portalDocumentTimelineEvent.create).not.toHaveBeenCalled()
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it("rejects completion when the request no longer matches the intent's organization or client", async () => {
    arrangePortal()
    currentTx.portalDocumentRequest.findUnique.mockResolvedValue(pendingRequest({ clientId: "cm88345678901234567890123" }))
    await expect(completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)).rejects.toThrow(/no longer available/i)
    expect(currentTx.supportingDocument.create).not.toHaveBeenCalled()
  })

  it("hides attempts belonging to another portal user", async () => {
    findAttemptMock.mockResolvedValue(portalAttempt({ portalUserId: "cm99345678901234567890123" }))
    await expect(completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)).rejects.toThrow(/not found/i)
  })

  it("hides staff attempts from the portal completion path", async () => {
    findAttemptMock.mockResolvedValue(staffAttempt({ supportingIntent: staffIntent() }))
    await expect(completePortalUpload(ATTEMPT_ID, PORTAL_USER_ID, fakeAdapter)).rejects.toThrow(/not found/i)
  })
})
