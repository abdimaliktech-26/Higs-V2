// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

const findAttemptMock = vi.fn()
const transactionMock = vi.fn()
const receiveMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    uploadAttempt: { findUnique: (...a: unknown[]) => findAttemptMock(...a) },
    $transaction: (cb: unknown) => transactionMock(cb),
  },
}))
vi.mock("@/lib/uploads/receipt", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/uploads/receipt")>()
  return {
    ...actual,
    receiveValidateAndBeginScan: (...a: unknown[]) => receiveMock(...a),
  }
})

import { initiatePortalUpload, initiateStaffSupportingUpload } from "@/lib/uploads/supporting-upload"

const ORG_ID = "cm12345678901234567890123"
const STAFF_ID = "cm22345678901234567890123"
const CLIENT_ID = "cm32345678901234567890123"
const PORTAL_USER_ID = "cm52345678901234567890123"
const REQUEST_ID = "cm62345678901234567890123"
const IDEMPOTENCY_KEY = "b2345678-1234-4234-9234-123456789abc"

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

function fakeFile(name = "care-plan.pdf", type = "application/pdf", size = 100): File {
  return { name, type, size, stream: () => ({}) } as never
}

interface FakeTx {
  uploadAttempt: { create: ReturnType<typeof vi.fn> }
  supportingUploadIntent: { create: ReturnType<typeof vi.fn> }
}

let currentTx: FakeTx

beforeEach(() => {
  vi.clearAllMocks()
  validEnvironment()
  findAttemptMock.mockResolvedValue(null)
  currentTx = {
    uploadAttempt: { create: vi.fn().mockImplementation(({ data }) => Promise.resolve({ id: "cm42345678901234567890123", ...data })) },
    supportingUploadIntent: { create: vi.fn().mockResolvedValue({ id: "intent-1" }) },
  }
  transactionMock.mockImplementation((cb: (tx: FakeTx) => unknown) => cb(currentTx))
  receiveMock.mockResolvedValue(undefined)
})

afterEach(() => vi.unstubAllEnvs())

describe("staff supporting upload initiation", () => {
  it("creates the attempt and intent atomically and stops at SCANNING", async () => {
    const result = await initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile(),
      intent: { title: "Care plan", category: "assessment", clientId: CLIENT_ID },
    })
    const attemptData = currentTx.uploadAttempt.create.mock.calls[0][0].data
    expect(attemptData.uploadKind).toBe("STAFF_SUPPORTING")
    expect(attemptData.intendedOwnerType).toBe("SUPPORTING_DOCUMENT")
    expect(attemptData.actorType).toBe("STAFF")
    expect(attemptData.staffUserId).toBe(STAFF_ID)
    const intentData = currentTx.supportingUploadIntent.create.mock.calls[0][0].data
    expect(intentData.title).toBe("Care plan")
    expect(intentData.clientId).toBe(CLIENT_ID)
    expect(intentData.supportingDocumentId).toBe(attemptData.intendedOwnerId)
    expect(receiveMock).toHaveBeenCalledOnce()
    expect(result.status).toBe("SCANNING")
  })

  it("plans a client-scoped durable key for client-bound uploads and an organization key otherwise", async () => {
    await initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile(),
      intent: { title: "Bound", clientId: CLIENT_ID },
    })
    expect(currentTx.uploadAttempt.create.mock.calls[0][0].data.plannedDurableObjectKey)
      .toContain(`/clients/${CLIENT_ID}/supporting/`)

    await initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: "c2345678-1234-4234-9234-123456789abc",
      file: fakeFile(),
      intent: { title: "Unbound" },
    })
    const unboundKey = currentTx.uploadAttempt.create.mock.calls[1][0].data.plannedDurableObjectKey
    expect(unboundKey).toContain(`organizations/${ORG_ID}/supporting/`)
    expect(unboundKey).not.toContain("/clients/")
  })

  it("replays an in-progress idempotency key without re-receiving bytes", async () => {
    findAttemptMock.mockResolvedValue({ id: "cm42345678901234567890123", status: "SCANNING", intendedOwnerId: "owner" })
    const result = await initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile(),
      intent: { title: "Care plan" },
    })
    expect(result).toEqual({ attemptId: "cm42345678901234567890123", status: "SCANNING", supportingDocumentId: undefined })
    expect(currentTx.uploadAttempt.create).not.toHaveBeenCalled()
    expect(receiveMock).not.toHaveBeenCalled()
  })

  it("returns the owner for a completed idempotency replay and conflicts on a failed one", async () => {
    findAttemptMock.mockResolvedValue({ id: "cm42345678901234567890123", status: "COMPLETED", intendedOwnerId: "owner-1" })
    const replay = await initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile(),
      intent: { title: "Care plan" },
    })
    expect(replay.supportingDocumentId).toBe("owner-1")

    findAttemptMock.mockResolvedValue({ id: "cm42345678901234567890123", status: "FAILED", intendedOwnerId: "owner-1" })
    await expect(initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile(),
      intent: { title: "Care plan" },
    })).rejects.toThrow(/already failed/i)
  })

  it("requires a UUID idempotency key", async () => {
    await expect(initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: "",
      file: fakeFile(),
      intent: { title: "Care plan" },
    })).rejects.toThrow(/idempotency key/i)
  })

  it("rejects oversized declared files before any attempt row exists", async () => {
    await expect(initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile("big.pdf", "application/pdf", 26 * 1024 * 1024),
      intent: { title: "Care plan" },
    })).rejects.toThrow(/size limit/i)
    expect(currentTx.uploadAttempt.create).not.toHaveBeenCalled()
  })

  it("fails closed when the operating gate is incomplete", async () => {
    vi.stubEnv("MALWARE_SCANNER_OPERATIONALLY_APPROVED", "false")
    await expect(initiateStaffSupportingUpload({
      organizationId: ORG_ID,
      staffUserId: STAFF_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      file: fakeFile(),
      intent: { title: "Care plan" },
    })).rejects.toThrow(/temporarily unavailable/i)
  })
})

describe("portal upload initiation", () => {
  it("creates a portal-actor attempt bound to the request with the sanitized display filename", async () => {
    const result = await initiatePortalUpload({
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      packetId: null,
      portalUserId: PORTAL_USER_ID,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      originalFileName: "insurance.jpg",
      file: fakeFile("insurance.jpg", "image/jpeg"),
    })
    const attemptData = currentTx.uploadAttempt.create.mock.calls[0][0].data
    expect(attemptData.uploadKind).toBe("PORTAL_REQUEST")
    expect(attemptData.actorType).toBe("PORTAL")
    expect(attemptData.portalUserId).toBe(PORTAL_USER_ID)
    expect(attemptData.staffUserId).toBeNull()
    expect(attemptData.parentResourceId).toBe(REQUEST_ID)
    expect(attemptData.plannedDurableObjectKey).toContain(`/portal-requests/${REQUEST_ID}/uploads/`)
    const intentData = currentTx.supportingUploadIntent.create.mock.calls[0][0].data
    expect(intentData.portalRequestId).toBe(REQUEST_ID)
    expect(intentData.clientId).toBe(CLIENT_ID)
    expect(intentData.originalFileName).toBe("insurance.jpg")
    expect(intentData.title).toBeUndefined()
    expect(result.status).toBe("SCANNING")
  })

  it("keeps the quarantine content type declared-but-untrusted, downgrading unknown declarations", async () => {
    await initiatePortalUpload({
      organizationId: ORG_ID,
      clientId: CLIENT_ID,
      portalUserId: PORTAL_USER_ID,
      requestId: REQUEST_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
      originalFileName: "photo.heic",
      file: fakeFile("photo.heic", "image/heic"),
    })
    // HEIC is not an accepted portal format in PR-5B.3, so its declared MIME
    // never becomes the quarantine content type; deep validation then rejects it.
    expect(receiveMock.mock.calls[0][0].quarantineMimeType).toBe("application/octet-stream")
  })
})
