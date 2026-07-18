// @vitest-environment node
import { UploadCleanupStatus, UploadStatus } from "@prisma/client"
import { beforeEach, describe, expect, it, vi } from "vitest"

const findManyMock = vi.fn()
const findUniqueMock = vi.fn()
const updateManyMock = vi.fn()

vi.mock("@/lib/db", () => ({
  prisma: {
    uploadAttempt: {
      findMany: (...a: unknown[]) => findManyMock(...a),
      findUnique: (...a: unknown[]) => findUniqueMock(...a),
      updateMany: (...a: unknown[]) => updateManyMock(...a),
    },
  },
}))

import {
  assertOperatorS3Storage,
  buildStorageBackedProbes,
  executeQuarantineCleanup,
  recoverStuckUploadAttempts,
} from "@/lib/uploads/operations"
import { recordScannerResult } from "@/lib/uploads/lifecycle"

const NOW = new Date("2026-07-17T12:00:00Z")
const ORG_ID = "cm12345678901234567890123"

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cm42345678901234567890123",
    organizationId: ORG_ID,
    status: UploadStatus.PROMOTING,
    ...overrides,
  }
}

function cleanupCandidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "cm42345678901234567890123",
    organizationId: ORG_ID,
    status: UploadStatus.FAILED,
    cleanupStatus: UploadCleanupStatus.PENDING,
    expiresAt: new Date(NOW.getTime() - 1000),
    quarantineObjectKey: `organizations/${ORG_ID}/uploads/a/b`,
    quarantineObjectVersionId: "qv1",
    ...overrides,
  }
}

function makeAdapter(overrides: Record<string, unknown> = {}) {
  return {
    provider: "s3",
    deleteObject: vi.fn().mockResolvedValue(undefined),
    objectExists: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as never
}

beforeEach(() => {
  vi.clearAllMocks()
  findManyMock.mockResolvedValue([])
  updateManyMock.mockResolvedValue({ count: 1 })
  findUniqueMock.mockImplementation(() => Promise.resolve(candidate({ status: UploadStatus.FAILED })))
})

describe("stuck upload recovery", () => {
  it("fails a stale PROMOTING attempt through the guarded transition", async () => {
    findManyMock.mockResolvedValue([candidate()])
    const summary = await recoverStuckUploadAttempts({ now: NOW })
    expect(summary.recovered).toBe(1)
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "cm42345678901234567890123", status: UploadStatus.PROMOTING },
      data: expect.objectContaining({ status: UploadStatus.FAILED, failureStage: "PROMOTION", failureCategory: "PROMOTION_FAILURE" }),
    }))
    expect(summary.outcomes[0].detail).toBe("FAILED_AT_PROMOTION")
  })

  it("cannot duplicate a live completion — the guarded update loses and records a bounded conflict", async () => {
    findManyMock.mockResolvedValue([candidate({ status: UploadStatus.LINKING })])
    updateManyMock.mockResolvedValue({ count: 0 })
    const summary = await recoverStuckUploadAttempts({ now: NOW })
    expect(summary.conflicted).toBe(1)
    expect(summary.recovered).toBe(0)
    expect(summary.outcomes[0].detail).toBe("STATE_CHANGED_CONCURRENTLY")
  })

  it("selects stale receipt states by updatedAt and quarantine states by expiry, bounded by the batch limit", async () => {
    await recoverStuckUploadAttempts({ now: NOW, staleAttemptMs: 30 * 60 * 1000, batchLimit: 7 })
    const query = findManyMock.mock.calls[0][0]
    expect(query.take).toBe(7)
    expect(query.orderBy).toEqual({ updatedAt: "asc" })
    const [staleBranch, expiredBranch] = query.where.OR
    expect(staleBranch.status.in).toEqual(expect.arrayContaining([UploadStatus.PROMOTING, UploadStatus.PROMOTED, UploadStatus.LINKING]))
    expect(staleBranch.updatedAt.lt).toEqual(new Date(NOW.getTime() - 30 * 60 * 1000))
    expect(expiredBranch.status.in).toEqual(expect.arrayContaining([UploadStatus.SCANNING]))
    expect(expiredBranch.expiresAt.lte).toEqual(NOW)
  })

  it("times out an expired SCANNING attempt as a scan failure", async () => {
    findManyMock.mockResolvedValue([candidate({ status: UploadStatus.SCANNING })])
    const summary = await recoverStuckUploadAttempts({ now: NOW })
    expect(summary.recovered).toBe(1)
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ failureStage: "SCAN", failureCategory: "SCAN_UNAVAILABLE" }),
    }))
  })

  it("performs no write in dry-run mode", async () => {
    findManyMock.mockResolvedValue([candidate()])
    const summary = await recoverStuckUploadAttempts({ now: NOW, dryRun: true })
    expect(summary.skipped).toBe(1)
    expect(updateManyMock).not.toHaveBeenCalled()
  })
})

describe("late scanner results after recovery", () => {
  it("cannot revive a timed-out attempt — the guarded scan update conflicts", async () => {
    updateManyMock.mockResolvedValue({ count: 0 })
    await expect(
      recordScannerResult("cm42345678901234567890123", { outcome: "CLEAN", scannedAt: NOW } as never),
    ).rejects.toThrow(/cannot be recorded/i)
  })
})

describe("quarantine cleanup execution", () => {
  it("deletes only the exact recorded quarantine version and records completion", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValue([cleanupCandidate()])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.cleaned).toBe(1)
    expect((adapter as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject).toHaveBeenCalledWith({
      key: `organizations/${ORG_ID}/uploads/a/b`,
      location: "quarantine",
      versionId: "qv1",
    })
    expect(summary.outcomes[0].detail).toBe("EXACT_VERSION_DELETED")
  })

  it("never deletes before the recorded retention expiry (7-day suspect hold included)", async () => {
    const adapter = makeAdapter()
    const suspectHold = new Date(NOW.getTime() + 6 * 24 * 60 * 60 * 1000)
    findManyMock.mockResolvedValue([cleanupCandidate({ expiresAt: suspectHold })])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.skipped).toBe(1)
    expect(summary.outcomes[0].detail).toBe("RETENTION_HOLD")
    expect((adapter as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject).not.toHaveBeenCalled()
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it("cleans a linked attempt immediately and advances it to COMPLETED", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValue([
      cleanupCandidate({ status: UploadStatus.LINKED_CLEANUP_PENDING, expiresAt: new Date(NOW.getTime() + 1000) }),
    ])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.cleaned).toBe(1)
    expect(updateManyMock).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ status: UploadStatus.LINKED_CLEANUP_PENDING }),
      data: expect.objectContaining({ status: UploadStatus.COMPLETED, cleanupStatus: UploadCleanupStatus.COMPLETED }),
    }))
  })

  it("refuses to guess when no exact version is recorded", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValue([cleanupCandidate({ quarantineObjectVersionId: null })])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.skipped).toBe(1)
    expect(summary.outcomes[0].detail).toBe("MISSING_OBJECT_VERSION")
    expect((adapter as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject).not.toHaveBeenCalled()
  })

  it("records nothing on a provider delete failure so the attempt stays PENDING for rerun", async () => {
    const adapter = makeAdapter({ deleteObject: vi.fn().mockRejectedValue(new Error("s3 down")) })
    findManyMock.mockResolvedValue([cleanupCandidate()])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.failed).toBe(1)
    expect(summary.outcomes[0].detail).toBe("PROVIDER_DELETE_ERROR")
    expect(updateManyMock).not.toHaveBeenCalled()
  })

  it("records a bounded conflict when the attempt changed concurrently", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValue([cleanupCandidate()])
    updateManyMock.mockResolvedValue({ count: 0 })
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.conflicted).toBe(1)
  })

  it("handles an attempt with no recorded object by completing cleanup without any delete", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValue([cleanupCandidate({ quarantineObjectKey: null, quarantineObjectVersionId: null })])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(summary.cleaned).toBe(1)
    expect(summary.outcomes[0].detail).toBe("NO_OBJECT_RECORDED")
    expect((adapter as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject).not.toHaveBeenCalled()
  })

  it("is idempotent across reruns — completed attempts leave the candidate set", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValueOnce([cleanupCandidate()]).mockResolvedValueOnce([])
    const first = await executeQuarantineCleanup(adapter, { now: NOW })
    const second = await executeQuarantineCleanup(adapter, { now: NOW })
    expect(first.cleaned).toBe(1)
    expect(second.attempted).toBe(0)
    const query = findManyMock.mock.calls[1][0]
    expect(query.where.cleanupStatus).toBe(UploadCleanupStatus.PENDING)
  })

  it("performs no delete in dry-run mode", async () => {
    const adapter = makeAdapter()
    findManyMock.mockResolvedValue([cleanupCandidate()])
    const summary = await executeQuarantineCleanup(adapter, { now: NOW, dryRun: true })
    expect(summary.skipped).toBe(1)
    expect((adapter as { deleteObject: ReturnType<typeof vi.fn> }).deleteObject).not.toHaveBeenCalled()
  })
})

describe("storage-backed reconciliation probes", () => {
  const configuration = { provider: "s3", durableBucket: "durable-b", quarantineBucket: "quarantine-b" } as never

  it("probes durable keys and versioned stored objects read-only", async () => {
    const adapter = makeAdapter({ objectExists: vi.fn().mockResolvedValue(false) })
    const { probes, failures } = buildStorageBackedProbes(adapter, configuration)
    await expect(probes.durableKeyExists!("some/key")).resolves.toBe(false)
    await expect(
      probes.storedObjectExists!({ provider: "S3", bucket: "durable-b", key: "k", versionId: "v1" }),
    ).resolves.toBe(false)
    expect((adapter as { objectExists: ReturnType<typeof vi.fn> }).objectExists).toHaveBeenCalledWith({ key: "k", location: "durable", versionId: "v1" })
    expect(failures).toHaveLength(0)
  })

  it("treats probe errors as existing and reports the failure instead of enabling destructive findings", async () => {
    const adapter = makeAdapter({ objectExists: vi.fn().mockRejectedValue(new Error("timeout")) })
    const { probes, failures } = buildStorageBackedProbes(adapter, configuration)
    await expect(probes.durableKeyExists!("some/key")).resolves.toBe(true)
    await expect(probes.storedObjectExists!({ provider: "S3", bucket: "quarantine-b", key: "k" })).resolves.toBe(true)
    expect(failures.map((failure) => failure.kind)).toEqual(["DURABLE_PROBE_ERROR", "STORED_OBJECT_PROBE_ERROR"])
  })

  it("treats unknown buckets and non-S3 providers as unprobeable, never missing", async () => {
    const adapter = makeAdapter()
    const { probes, failures } = buildStorageBackedProbes(adapter, configuration)
    await expect(probes.storedObjectExists!({ provider: "S3", bucket: "other-bucket", key: "k" })).resolves.toBe(true)
    await expect(probes.storedObjectExists!({ provider: "LOCAL" as never, bucket: "durable-b", key: "k" })).resolves.toBe(true)
    expect(failures.every((failure) => failure.kind === "UNPROBEABLE_LOCATION")).toBe(true)
    expect((adapter as { objectExists: ReturnType<typeof vi.fn> }).objectExists).not.toHaveBeenCalled()
  })
})

describe("operator storage gate", () => {
  it("refuses local and memory storage for destructive or evidence-producing tools", () => {
    expect(() => assertOperatorS3Storage({ provider: "local" } as never, "upload cleanup")).toThrow(/Refusing to run/)
    expect(() => assertOperatorS3Storage({ provider: "memory" } as never, "platform verification")).toThrow(/Refusing to run/)
    expect(() => assertOperatorS3Storage({ provider: "s3" } as never, "upload cleanup")).not.toThrow()
  })
})
