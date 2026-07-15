import {
  StoredObjectLifecycleStatus,
  StoredObjectMalwareStatus,
  UploadActorType,
  UploadCleanupStatus,
  UploadFailureCategory,
  UploadKind,
  UploadOwnerType,
  UploadStatus,
} from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { getUploadCapability } from "@/lib/uploads/capability"
import {
  assertUploadTransition,
  beginPromotion,
  buildInitiatedUploadData,
  getIdempotencyDisposition,
  hashIdempotencyKey,
  isTerminalUploadStatus,
  recordVerifiedPromotion,
} from "@/lib/uploads/lifecycle"
import {
  DeterministicCleanTestScanner,
  DeterministicErrorTestScanner,
  DeterministicInfectedTestScanner,
  DisabledMalwareScanner,
} from "@/lib/uploads/scanner"

const UUID = "11111111-1111-4111-8111-111111111111"
const ORG_ID = "22222222-2222-4222-8222-222222222222"
const OWNER_ID = "33333333-3333-4333-8333-333333333333"
const USER_ID = "44444444-4444-4444-8444-444444444444"
const ARTIFACT_ID = "55555555-5555-4555-8555-555555555555"

describe("upload lifecycle foundation", () => {
  it("hashes UUID idempotency keys and never retains the raw token", () => {
    const data = buildInitiatedUploadData({
      organizationId: ORG_ID,
      uploadKind: UploadKind.TEMPLATE,
      intendedOwnerType: UploadOwnerType.DOCUMENT_TEMPLATE,
      intendedOwnerId: OWNER_ID,
      actor: { type: "STAFF", staffUserId: USER_ID },
      idempotencyKey: UUID,
      artifactId: ARTIFACT_ID,
      plannedDurableObjectKey: `organizations/${ORG_ID}/templates/${OWNER_ID}/source/${ARTIFACT_ID}.pdf`,
      expectedSizeBytes: 10,
      now: new Date("2026-07-15T00:00:00Z"),
    })
    expect(data).toMatchObject({
      actorType: UploadActorType.STAFF,
      actorIdentityId: USER_ID,
      staffUserId: USER_ID,
      portalUserId: null,
      status: UploadStatus.INITIATED,
      malwareStatus: StoredObjectMalwareStatus.NOT_SCANNED,
    })
    expect(data.idempotencyKeyHash).toBe(hashIdempotencyKey(UUID))
    expect(Object.values(data).map(String)).not.toContain(UUID)
    expect(() => hashIdempotencyKey("not-a-uuid")).toThrow(/UUID/)
    expect(() =>
      buildInitiatedUploadData({
        organizationId: ORG_ID,
        uploadKind: UploadKind.TEMPLATE,
        intendedOwnerType: UploadOwnerType.DOCUMENT_TEMPLATE,
        intendedOwnerId: OWNER_ID,
        actor: { type: "STAFF", staffUserId: USER_ID },
        idempotencyKey: UUID,
        artifactId: ARTIFACT_ID,
        plannedDurableObjectKey: `organizations/${ORG_ID}/templates/client-name/source/${ARTIFACT_ID}.pdf`,
      }),
    ).toThrow(/opaque IDs/)
    expect(() =>
      buildInitiatedUploadData({
        organizationId: ORG_ID,
        uploadKind: UploadKind.PORTAL_REQUEST,
        intendedOwnerType: UploadOwnerType.SUPPORTING_DOCUMENT,
        intendedOwnerId: OWNER_ID,
        actor: { type: "STAFF", staffUserId: USER_ID, portalUserId: "66666666-6666-4666-8666-666666666666" } as never,
        idempotencyKey: UUID,
        artifactId: ARTIFACT_ID,
        plannedDurableObjectKey: `organizations/${ORG_ID}/templates/${OWNER_ID}/source/${ARTIFACT_ID}.pdf`,
      }),
    ).toThrow(/Exactly one/)
  })

  it("enforces legal progression and terminal idempotency behavior", () => {
    expect(() => assertUploadTransition(UploadStatus.INITIATED, UploadStatus.RECEIVING)).not.toThrow()
    expect(() => assertUploadTransition(UploadStatus.VALIDATED, UploadStatus.PROMOTING)).toThrow(/not allowed/)
    expect(() => assertUploadTransition(UploadStatus.FAILED, UploadStatus.RECEIVING)).toThrow(/not allowed/)
    expect(isTerminalUploadStatus(UploadStatus.COMPLETED)).toBe(true)
    expect(isTerminalUploadStatus(UploadStatus.FAILED)).toBe(true)
    expect(getIdempotencyDisposition(UploadStatus.COMPLETED)).toBe("RETURN_COMPLETED")
    expect(getIdempotencyDisposition(UploadStatus.SCANNING)).toBe("IN_PROGRESS")
    expect(getIdempotencyDisposition(UploadStatus.FAILED)).toBe("FAILED_TERMINAL")
  })

  it("requires a real clean scanner state before promotion", async () => {
    const client = {
      uploadAttempt: {
        findUnique: vi.fn().mockResolvedValue({ status: UploadStatus.SCANNING, malwareStatus: StoredObjectMalwareStatus.NOT_SCANNED }),
      },
    }
    await expect(beginPromotion("attempt", client as never)).rejects.toMatchObject({ code: "SCAN_UNAVAILABLE" })
  })

  it("creates StoredObject only after verified durable metadata and leaves it PENDING", async () => {
    const create = vi.fn().mockResolvedValue({ id: "stored_opaque" })
    const attempt = {
      id: "attempt_opaque",
      organizationId: ORG_ID,
      status: UploadStatus.PROMOTING,
      checksumSha256: "a".repeat(64),
      actualSizeBytes: BigInt(10),
      plannedDurableObjectKey: `organizations/${ORG_ID}/templates/${OWNER_ID}/source/${ARTIFACT_ID}.pdf`,
      malwareStatus: StoredObjectMalwareStatus.CLEAN,
      validatedAt: new Date(),
      scannedAt: new Date(),
    }
    const tx = {
      uploadAttempt: {
        findUnique: vi.fn().mockResolvedValueOnce(attempt).mockResolvedValueOnce({ ...attempt, status: UploadStatus.PROMOTED }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      storedObject: { create },
    }
    const database = { $transaction: vi.fn(async (callback) => callback(tx)) }
    await recordVerifiedPromotion(
      "attempt_opaque",
      {
        provider: "S3",
        bucket: "opaque-bucket",
        objectKey: attempt.plannedDurableObjectKey,
        checksumSha256: attempt.checksumSha256,
        sizeBytes: 10,
        mimeType: "application/pdf",
        encryptionKeyRef: "opaque-key-ref",
        providerVerified: true,
        encryptionVerified: true,
        promotedAt: new Date(),
      },
      database as never,
    )
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        lifecycleStatus: StoredObjectLifecycleStatus.PENDING,
        malwareStatus: StoredObjectMalwareStatus.CLEAN,
        immutable: false,
        originalFileName: null,
      }),
    })
    expect(create).not.toHaveBeenCalledWith({ data: expect.objectContaining({ lifecycleStatus: StoredObjectLifecycleStatus.AVAILABLE }) })
  })

  it("rejects promotion metadata that is not provider/encryption verified", async () => {
    await expect(
      recordVerifiedPromotion(
        "attempt",
        {
          provider: "S3",
          bucket: "bucket",
          objectKey: "key",
          checksumSha256: "a".repeat(64),
          sizeBytes: 1,
          mimeType: "application/pdf",
          providerVerified: false,
          encryptionVerified: false,
          promotedAt: new Date(),
        },
        { $transaction: vi.fn() } as never,
      ),
    ).rejects.toMatchObject({ code: "PROMOTION_NOT_VERIFIED" })
  })
})

describe("malware scanner boundary and production capability", () => {
  it("disabled scanners never report CLEAN and keep production upload unavailable", async () => {
    const scanner = new DisabledMalwareScanner()
    expect(await scanner.scan({ attemptId: "attempt", openStream: vi.fn() })).toMatchObject({ outcome: "ERROR" })
    expect(
      await getUploadCapability({ scanner, environment: "production", storageProvider: "s3", platformLimitsVerified: true }),
    ).toMatchObject({ acceptsProductionUploads: false, reasons: expect.arrayContaining(["SCANNER_DISABLED"]), syntheticDataOnly: true })
  })

  it("provides deterministic non-network test scanners", async () => {
    const input = { attemptId: "attempt", openStream: vi.fn() }
    expect((await new DeterministicCleanTestScanner().scan(input)).outcome).toBe("CLEAN")
    expect((await new DeterministicInfectedTestScanner().scan(input)).outcome).toBe("INFECTED")
    expect((await new DeterministicErrorTestScanner().scan(input)).outcome).toBe("ERROR")
  })

  it("requires verified hosting limits in production even with a clean-capable scanner", async () => {
    const capability = await getUploadCapability({
      scanner: new DeterministicCleanTestScanner(),
      environment: "production",
      storageProvider: "s3",
    })
    expect(capability.acceptsProductionUploads).toBe(false)
    expect(capability.reasons).toContain("PLATFORM_LIMITS_UNVERIFIED")
    expect(capability.reasons).toContain("SCANNER_NOT_APPROVED")
  })
})
