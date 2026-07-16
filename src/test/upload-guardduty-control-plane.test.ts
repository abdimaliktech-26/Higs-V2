import {
  StoredObjectMalwareStatus,
  UploadCleanupStatus,
  UploadScannerProvider,
  UploadStatus,
} from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { getConfiguredUploadCapability } from "@/lib/uploads/capability"
import { readUploadScannerConfiguration } from "@/lib/uploads/config"
import { UploadScanEventError } from "@/lib/uploads/errors"
import { parseGuardDutyScanResultEvent, processGuardDutySqsMessage } from "@/lib/uploads/guardduty"

const CONFIG_ENV = {
  MALWARE_SCANNER_PROVIDER: "guardduty-s3",
  GUARDDUTY_EXPECTED_AWS_ACCOUNT_ID: "123456789012",
  GUARDDUTY_EXPECTED_REGION: "us-east-2",
  GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN: "arn:aws:guardduty:us-east-2:123456789012:malware-protection-plan/abc123",
  GUARDDUTY_SCAN_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/123456789012/higsi-scan-results",
  S3_QUARANTINE_BUCKET: "higsi-quarantine-prod",
  STORAGE_PROVIDER: "s3",
  AWS_REGION: "us-east-2",
  S3_DURABLE_BUCKET: "higsi-durable-prod",
  S3_KMS_KEY_ARN: "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012",
  S3_SIGNED_URL_TTL_SECONDS: "60",
  MALWARE_SCANNER_OPERATIONALLY_APPROVED: "true",
  UPLOAD_PLATFORM_LIMITS_VERIFIED: "true",
}

const KEY = "organizations/22222222-2222-4222-8222-222222222222/uploads/33333333-3333-4333-8333-333333333333/44444444-4444-4444-8444-444444444444"

function eventPayload(result = "NO_THREATS_FOUND") {
  const scanStatus = result === "NO_THREATS_FOUND" || result === "THREATS_FOUND"
    ? "COMPLETED"
    : result === "UNSUPPORTED" || result === "ACCESS_DENIED"
      ? "SKIPPED"
      : "FAILED"
  return {
    version: "0",
    id: "11111111-1111-4111-8111-111111111111",
    "detail-type": "GuardDuty Malware Protection Object Scan Result",
    source: "aws.guardduty",
    account: "123456789012",
    time: "2026-07-15T18:00:00.000Z",
    region: "us-east-2",
    resources: [CONFIG_ENV.GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN],
    detail: {
      schemaVersion: "1.0",
      scanStatus,
      resourceType: "S3_OBJECT",
      s3ObjectDetails: {
        bucketName: CONFIG_ENV.S3_QUARANTINE_BUCKET,
        objectKey: KEY,
        eTag: '"etag-opaque"',
        versionId: "version-opaque",
      },
      scanResultDetails: { scanResultStatus: result, threats: [{ name: "must-not-persist" }] },
    },
  }
}

function event(result = "NO_THREATS_FOUND", overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ ...eventPayload(result), ...overrides })
}

function alteredEvent(
  result: string,
  mutate: (payload: ReturnType<typeof eventPayload>) => void,
): string {
  const payload = eventPayload(result)
  mutate(payload)
  return JSON.stringify(payload)
}

describe("GuardDuty S3 scanner configuration", () => {
  it("requires a trusted account, region, plan, queue, and quarantine bucket", () => {
    expect(readUploadScannerConfiguration(CONFIG_ENV)).toMatchObject({
      provider: "guardduty-s3",
      operationallyApproved: true,
      platformLimitsVerified: true,
      errors: [],
    })
    expect(readUploadScannerConfiguration({ ...CONFIG_ENV, GUARDDUTY_SCAN_QUEUE_URL: "http://localhost/queue" }).errors).toContain(
      "GUARDDUTY_SCAN_QUEUE_URL must be a regional HTTPS SQS queue URL for the configured account",
    )
    expect(readUploadScannerConfiguration({ ...CONFIG_ENV, GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN: "change-me" }).errors).toContain(
      "GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN must match the configured account and region",
    )
    expect(readUploadScannerConfiguration({ ...CONFIG_ENV, GUARDDUTY_EXPECTED_REGION: "us-west-2" }).errors).toContain(
      "GUARDDUTY_EXPECTED_REGION must match AWS_REGION",
    )
  })

  it("keeps capability closed unless the event scanner and dedicated runtime are approved", async () => {
    expect(await getConfiguredUploadCapability({ environment: "production", scannerEnvironment: CONFIG_ENV, storageEnvironment: CONFIG_ENV })).toMatchObject({
      acceptsProductionUploads: true,
      scannerAvailability: "available",
      syntheticDataOnly: true,
    })
    const closed = await getConfiguredUploadCapability({
      environment: "production",
      scannerEnvironment: { ...CONFIG_ENV, MALWARE_SCANNER_OPERATIONALLY_APPROVED: "false", UPLOAD_PLATFORM_LIMITS_VERIFIED: "false" },
      storageEnvironment: CONFIG_ENV,
    })
    expect(closed.acceptsProductionUploads).toBe(false)
    expect(closed.reasons).toEqual(expect.arrayContaining(["SCANNER_NOT_APPROVED", "PLATFORM_LIMITS_UNVERIFIED"]))

    const invalidStorage = await getConfiguredUploadCapability({
      environment: "production",
      scannerEnvironment: CONFIG_ENV,
      storageEnvironment: { ...CONFIG_ENV, S3_DURABLE_BUCKET: CONFIG_ENV.S3_QUARANTINE_BUCKET },
    })
    expect(invalidStorage.acceptsProductionUploads).toBe(false)
    expect(invalidStorage.reasons).toContain("STORAGE_NOT_PRODUCTION_SAFE")
  })
})

describe("GuardDuty S3 EventBridge/SQS result processing", () => {
  const configuration = readUploadScannerConfiguration(CONFIG_ENV)

  it("parses only bounded identity/result fields and rejects foreign events", () => {
    const parsed = parseGuardDutyScanResultEvent(event(), configuration)
    expect(parsed).toMatchObject({
      eventId: "11111111-1111-4111-8111-111111111111",
      objectKey: KEY,
      objectVersionId: "version-opaque",
      etag: "etag-opaque",
      resultStatus: "NO_THREATS_FOUND",
    })
    expect(JSON.stringify(parsed)).not.toContain("must-not-persist")
    expect(() => parseGuardDutyScanResultEvent(event("NO_THREATS_FOUND", { account: "999999999999" }), configuration)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_EVENT", retryable: false }),
    )
    expect(() => parseGuardDutyScanResultEvent(event("NO_THREATS_FOUND", { resources: ["arn:foreign"] }), configuration)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_EVENT" }),
    )
    expect(() => parseGuardDutyScanResultEvent(event("NO_THREATS_FOUND", { region: "us-west-2" }), configuration)).toThrowError(
      expect.objectContaining({ code: "UNTRUSTED_EVENT" }),
    )
    expect(() => parseGuardDutyScanResultEvent(alteredEvent("NO_THREATS_FOUND", (payload) => {
      payload.detail.s3ObjectDetails.bucketName = "foreign-bucket"
    }), configuration)).toThrowError(expect.objectContaining({ code: "UNTRUSTED_EVENT" }))
  })

  it("rejects malformed, incomplete, unknown, and inconsistent scan results", () => {
    expect(() => parseGuardDutyScanResultEvent("not-json", configuration)).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }))
    expect(() => parseGuardDutyScanResultEvent(alteredEvent("NO_THREATS_FOUND", (payload) => {
      payload.detail.s3ObjectDetails.versionId = ""
    }), configuration)).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }))
    expect(() => parseGuardDutyScanResultEvent(alteredEvent("UNKNOWN", () => undefined), configuration)).toThrowError(
      expect.objectContaining({ code: "INVALID_EVENT" }),
    )
    expect(() => parseGuardDutyScanResultEvent(alteredEvent("NO_THREATS_FOUND", (payload) => {
      payload.detail.scanStatus = "FAILED"
    }), configuration)).toThrowError(expect.objectContaining({ code: "INVALID_EVENT" }))
  })

  it("records a version-bound clean result exactly once", async () => {
    const attempt = {
      id: "attempt-opaque",
      status: UploadStatus.SCANNING,
      scannerProvider: UploadScannerProvider.GUARDDUTY_S3,
      scannerReference: null,
      malwareStatus: StoredObjectMalwareStatus.PENDING,
      quarantineEtag: "etag-opaque",
      quarantinedAt: new Date("2026-07-15T17:59:00Z"),
    }
    const tx = {
      uploadAttempt: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(attempt),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ ...attempt, malwareStatus: StoredObjectMalwareStatus.CLEAN }),
      },
    }
    const database = { $transaction: vi.fn((callback) => callback(tx)) }
    await expect(processGuardDutySqsMessage(event(), configuration, database as never, new Date("2026-07-15T18:00:01Z"))).resolves.toBe("RECORDED_CLEAN")
    expect(tx.uploadAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        malwareStatus: StoredObjectMalwareStatus.CLEAN,
        scannerReference: "11111111-1111-4111-8111-111111111111",
      }),
    }))
  })

  it.each([
    ["THREATS_FOUND", StoredObjectMalwareStatus.INFECTED],
    ["UNSUPPORTED", StoredObjectMalwareStatus.ERROR],
    ["ACCESS_DENIED", StoredObjectMalwareStatus.ERROR],
    ["FAILED", StoredObjectMalwareStatus.ERROR],
  ])("fails closed for %s", async (result, malwareStatus) => {
    const attempt = {
      id: "attempt-opaque",
      status: UploadStatus.SCANNING,
      scannerProvider: UploadScannerProvider.GUARDDUTY_S3,
      scannerReference: null,
      malwareStatus: StoredObjectMalwareStatus.PENDING,
      quarantineEtag: "etag-opaque",
      quarantinedAt: new Date("2026-07-15T17:59:00Z"),
    }
    const tx = {
      uploadAttempt: {
        findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(attempt),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        findUnique: vi.fn().mockResolvedValue({ ...attempt, status: UploadStatus.FAILED, malwareStatus }),
      },
    }
    const database = { $transaction: vi.fn((callback) => callback(tx)) }
    await expect(processGuardDutySqsMessage(event(result), configuration, database as never)).resolves.toBe("RECORDED_FAILED")
    expect(tx.uploadAttempt.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ malwareStatus, cleanupStatus: UploadCleanupStatus.PENDING }),
    }))
  })

  it("acknowledges duplicates and retries an event that races lifecycle persistence", async () => {
    const duplicateTx = {
      uploadAttempt: { findFirst: vi.fn().mockResolvedValue({
        scannerReference: "11111111-1111-4111-8111-111111111111",
        quarantineProvider: "S3",
        quarantineBucket: CONFIG_ENV.S3_QUARANTINE_BUCKET,
        quarantineObjectKey: KEY,
        quarantineObjectVersionId: "version-opaque",
        quarantineEtag: "etag-opaque",
      }) },
    }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(duplicateTx)) } as never)).resolves.toBe("ACK_DUPLICATE")

    const missingTx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValue(null) } }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(missingTx)) } as never)).rejects.toSatisfy(
      (error: unknown) => error instanceof UploadScanEventError && error.code === "ATTEMPT_NOT_READY" && error.retryable,
    )
  })

  it("rejects a conflicting replay that reuses an event ID for another object", async () => {
    const conflictingTx = {
      uploadAttempt: { findFirst: vi.fn().mockResolvedValue({
        scannerReference: "11111111-1111-4111-8111-111111111111",
        quarantineProvider: "S3",
        quarantineBucket: CONFIG_ENV.S3_QUARANTINE_BUCKET,
        quarantineObjectKey: `${KEY}-different`,
        quarantineObjectVersionId: "version-opaque",
        quarantineEtag: "etag-opaque",
      }) },
    }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(conflictingTx)) } as never)).rejects.toMatchObject({
      code: "EVENT_CONFLICT",
      retryable: false,
    })
  })

  it("does not allow a later clean replay to overwrite prior infected evidence", async () => {
    const infected = {
      status: UploadStatus.FAILED,
      scannerProvider: UploadScannerProvider.GUARDDUTY_S3,
      scannerReference: "99999999-9999-4999-8999-999999999999",
      malwareStatus: StoredObjectMalwareStatus.INFECTED,
      quarantineEtag: "etag-opaque",
      quarantinedAt: new Date("2026-07-15T17:59:00Z"),
    }
    const tx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(infected), updateMany: vi.fn() } }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(tx)) } as never)).rejects.toMatchObject({
      code: "EVENT_CONFLICT",
      retryable: false,
    })
    expect(tx.uploadAttempt.updateMany).not.toHaveBeenCalled()
  })

  it.each([
    ["another object key", alteredEvent("NO_THREATS_FOUND", (payload) => {
      payload.detail.s3ObjectDetails.objectKey = KEY.replace("44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555")
    })],
    ["another object version", alteredEvent("NO_THREATS_FOUND", (payload) => { payload.detail.s3ObjectDetails.versionId = "newer-version" })],
  ])("does not match %s", async (_label, body) => {
    const tx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValue(null) } }
    await expect(processGuardDutySqsMessage(body, configuration, { $transaction: vi.fn((cb) => cb(tx)) } as never)).rejects.toMatchObject({
      code: "ATTEMPT_NOT_READY",
      retryable: true,
    })
    expect(tx.uploadAttempt.findFirst).toHaveBeenCalledTimes(2)
  })

  it("rejects ETag and stale timestamp mismatches", async () => {
    const mismatched = {
      id: "attempt-opaque",
      status: UploadStatus.SCANNING,
      scannerProvider: UploadScannerProvider.GUARDDUTY_S3,
      scannerReference: null,
      malwareStatus: StoredObjectMalwareStatus.PENDING,
      quarantineEtag: "different-etag",
      quarantinedAt: new Date("2026-07-15T17:59:00Z"),
    }
    const mismatchTx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(mismatched) } }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(mismatchTx)) } as never)).rejects.toMatchObject({ code: "EVENT_CONFLICT" })

    const stale = { ...mismatched, quarantineEtag: "etag-opaque", quarantinedAt: new Date("2026-07-15T19:00:00Z") }
    const staleTx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(stale) } }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(staleTx)) } as never, new Date("2026-07-15T19:01:00Z"))).rejects.toMatchObject({ code: "EVENT_CONFLICT" })
  })

  it.each([UploadStatus.FAILED, UploadStatus.COMPLETED])("acknowledges terminal %s without reactivation", async (status) => {
    const terminal = {
      status,
      scannerReference: null,
      quarantineEtag: "etag-opaque",
      quarantinedAt: new Date("2026-07-15T17:59:00Z"),
    }
    const tx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(terminal), updateMany: vi.fn() } }
    await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(tx)) } as never)).resolves.toBe("ACK_TERMINAL")
    expect(tx.uploadAttempt.updateMany).not.toHaveBeenCalled()
  })

  it.each([UploadStatus.PROMOTING, UploadStatus.PROMOTED, UploadStatus.LINKING, UploadStatus.LINKED_CLEANUP_PENDING])(
    "rejects a result after the valid scan stage: %s",
    async (status) => {
      const beyond = {
        status,
        scannerReference: null,
        quarantineEtag: "etag-opaque",
        quarantinedAt: new Date("2026-07-15T17:59:00Z"),
      }
      const tx = { uploadAttempt: { findFirst: vi.fn().mockResolvedValueOnce(null).mockResolvedValueOnce(beyond) } }
      await expect(processGuardDutySqsMessage(event(), configuration, { $transaction: vi.fn((cb) => cb(tx)) } as never)).rejects.toMatchObject({
        code: "EVENT_CONFLICT",
        retryable: false,
      })
    },
  )
})
