import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  StoredObjectMalwareStatus,
  UploadActorType,
  UploadCleanupStatus,
  UploadKind,
  UploadOwnerType,
  UploadStatus,
} from "@prisma/client"

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  getLiveStaffAuthorizationContext: vi.fn(),
  requireActiveOrganizationMembership: vi.fn(),
}))

vi.mock("@/lib/db", () => ({ prisma: { uploadAttempt: { findUnique: mocks.findUnique } } }))
vi.mock("@/lib/live-authorization", () => ({
  getLiveStaffAuthorizationContext: mocks.getLiveStaffAuthorizationContext,
  requireActiveOrganizationMembership: mocks.requireActiveOrganizationMembership,
}))

import { GET } from "@/app/api/uploads/[attemptId]/status/route"

const ATTEMPT_ID = "cm12345678901234567890"

function attempt(overrides: Record<string, unknown> = {}) {
  return {
    id: ATTEMPT_ID,
    organizationId: "org-opaque",
    uploadKind: UploadKind.TEMPLATE,
    status: UploadStatus.SCANNING,
    intendedOwnerType: UploadOwnerType.DOCUMENT_TEMPLATE,
    intendedOwnerId: "owner-opaque",
    parentResourceId: null,
    actorType: UploadActorType.STAFF,
    actorIdentityId: "user-opaque",
    staffUserId: "user-opaque",
    portalUserId: null,
    idempotencyKeyHash: "a".repeat(64),
    artifactId: "artifact-opaque",
    declaredMimeType: "application/pdf",
    expectedSizeBytes: BigInt(10),
    actualSizeBytes: BigInt(10),
    checksumSha256: "b".repeat(64),
    quarantineProvider: "S3",
    quarantineBucket: "must-not-leak-bucket",
    quarantineObjectKey: "must-not-leak-key",
    quarantineObjectVersionId: "must-not-leak-version",
    quarantineEtag: "must-not-leak-etag",
    plannedDurableObjectKey: "must-not-leak-durable-key",
    storedObjectId: null,
    malwareStatus: StoredObjectMalwareStatus.PENDING,
    scannerProvider: "GUARDDUTY_S3",
    scannerReference: null,
    scanRequestedAt: new Date("2026-07-15T18:00:00Z"),
    scanResultReceivedAt: null,
    failureStage: null,
    failureCategory: null,
    cleanupStatus: UploadCleanupStatus.PENDING,
    expiresAt: new Date("2026-07-16T18:00:00Z"),
    quarantinedAt: new Date("2026-07-15T17:59:00Z"),
    validatedAt: new Date("2026-07-15T17:59:30Z"),
    scannedAt: null,
    promotedAt: null,
    linkedAt: null,
    cleanupCompletedAt: null,
    createdAt: new Date("2026-07-15T17:58:00Z"),
    updatedAt: new Date("2026-07-15T18:00:00Z"),
    ...overrides,
  }
}

async function call(attemptId = ATTEMPT_ID) {
  return GET(new Request(`http://localhost/api/uploads/${attemptId}/status`), { params: Promise.resolve({ attemptId }) })
}

describe("staff upload status route", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getLiveStaffAuthorizationContext.mockResolvedValue({ userId: "user-opaque" })
    mocks.requireActiveOrganizationMembership.mockResolvedValue({ userId: "user-opaque", organizationId: "org-opaque" })
  })

  it("requires a live authenticated staff identity", async () => {
    mocks.getLiveStaffAuthorizationContext.mockRejectedValue(new Error("denied"))
    expect((await call()).status).toBe(401)
    expect(mocks.findUnique).not.toHaveBeenCalled()
  })

  it("does not reveal another actor's attempt", async () => {
    mocks.findUnique.mockResolvedValue(attempt({ staffUserId: "different-user" }))
    const response = await call()
    expect(response.status).toBe(404)
    expect(mocks.requireActiveOrganizationMembership).not.toHaveBeenCalled()
  })

  it("does not expose a portal actor through the staff status route", async () => {
    mocks.findUnique.mockResolvedValue(attempt({ actorType: UploadActorType.PORTAL, staffUserId: null, portalUserId: "portal-opaque" }))
    expect((await call()).status).toBe(404)
    expect(mocks.requireActiveOrganizationMembership).not.toHaveBeenCalled()
  })

  it("rejects revoked organization access at request time", async () => {
    mocks.getLiveStaffAuthorizationContext.mockResolvedValue({ userId: "user-opaque", selectedOrganizationId: "different-org" })
    mocks.findUnique.mockResolvedValue(attempt())
    mocks.requireActiveOrganizationMembership.mockRejectedValue(new Error("revoked"))
    expect((await call()).status).toBe(403)
    expect(mocks.requireActiveOrganizationMembership).toHaveBeenCalledWith("org-opaque", "view own upload status")
  })

  it("returns only bounded status data with private no-store caching", async () => {
    mocks.findUnique.mockResolvedValue(attempt())
    const response = await call()
    expect(response.status).toBe(200)
    expect(response.headers.get("cache-control")).toBe("private, no-store")
    const payload = await response.json()
    expect(payload).toMatchObject({
      success: true,
      data: {
        attemptId: ATTEMPT_ID,
        status: UploadStatus.SCANNING,
        malwareStatus: StoredObjectMalwareStatus.PENDING,
        terminal: false,
      },
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain("must-not-leak")
    expect(serialized).not.toContain("organizationId")
    expect(serialized).not.toContain("owner-opaque")
  })

  it("returns the opaque owner only after successful completion", async () => {
    mocks.findUnique.mockResolvedValue(attempt({ status: UploadStatus.COMPLETED }))
    const payload = await (await call()).json()
    expect(payload.data).toMatchObject({ terminal: true, ownerId: "owner-opaque" })
  })
})
