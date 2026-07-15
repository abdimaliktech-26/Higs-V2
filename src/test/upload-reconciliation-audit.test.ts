import {
  StoredObjectLifecycleStatus,
  UploadCleanupStatus,
  UploadOwnerType,
  UploadStatus,
} from "@prisma/client"
import { describe, expect, it, vi } from "vitest"
import { writeStrictPortalUploadAudit, writeStrictStaffUploadAudit } from "@/lib/uploads/audit"
import { generateUploadReconciliationReport } from "@/lib/uploads/reconciliation"

describe("strict upload audit boundary", () => {
  it("writes bounded staff audit metadata and propagates database errors", async () => {
    const failure = new Error("database unavailable")
    const create = vi.fn().mockRejectedValue(failure)
    await expect(
      writeStrictStaffUploadAudit(
        { auditEvent: { create } } as never,
        {
          organizationId: "org_opaque",
          staffUserId: "user_opaque",
          uploadAttemptId: "attempt_opaque",
          storedObjectId: "stored_opaque",
          ownerType: UploadOwnerType.SUPPORTING_DOCUMENT,
          ownerId: "owner_opaque",
          sizeBytes: 12,
          mimeType: "application/pdf",
        },
      ),
    ).rejects.toBe(failure)
    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        metadata: {
          uploadAttemptId: "attempt_opaque",
          storedObjectId: "stored_opaque",
          sizeBytes: 12,
          mimeType: "application/pdf",
        },
      }),
    })
  })

  it("keeps portal audit evidence in the portal audit table", async () => {
    const create = vi.fn().mockResolvedValue({ id: "audit" })
    await writeStrictPortalUploadAudit(
      { portalAuditEvent: { create } } as never,
      {
        organizationId: "org_opaque",
        portalUserId: "portal_opaque",
        clientId: "client_opaque",
        uploadAttemptId: "attempt_opaque",
        storedObjectId: "stored_opaque",
        ownerType: UploadOwnerType.SUPPORTING_DOCUMENT,
        ownerId: "owner_opaque",
        sizeBytes: 12,
        mimeType: "application/pdf",
      },
    )
    expect(create).toHaveBeenCalledOnce()
  })
})

describe("read-only upload reconciliation", () => {
  it("emits bounded deterministic findings without mutation or storage locations", async () => {
    const now = new Date("2026-07-15T12:00:00Z")
    const stale = new Date("2026-07-15T08:00:00Z")
    const client = {
      uploadAttempt: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "attempt-stale",
            organizationId: "org",
            status: UploadStatus.RECEIVING,
            cleanupStatus: UploadCleanupStatus.NOT_REQUIRED,
            expiresAt: now,
            updatedAt: stale,
            intendedOwnerType: UploadOwnerType.SUPPORTING_DOCUMENT,
            intendedOwnerId: "owner-1",
            plannedDurableObjectKey: "secret-key-1",
            storedObjectId: null,
          },
          {
            id: "attempt-promotion",
            organizationId: "org",
            status: UploadStatus.PROMOTING,
            cleanupStatus: UploadCleanupStatus.PENDING,
            expiresAt: now,
            updatedAt: stale,
            intendedOwnerType: UploadOwnerType.DOCUMENT_TEMPLATE,
            intendedOwnerId: "owner-2",
            plannedDurableObjectKey: "secret-key-2",
            storedObjectId: null,
          },
        ]),
      },
      storedObject: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: "stored-pending",
            organizationId: "org",
            provider: "S3",
            bucket: "secret-bucket",
            objectKey: "secret-key-3",
            objectVersionId: "version",
            lifecycleStatus: StoredObjectLifecycleStatus.PENDING,
            documentTemplate: null,
            pdfVersion: null,
            supportingDocument: null,
          },
        ]),
      },
      pdfVersion: { findMany: vi.fn().mockResolvedValue([{ id: "pdf-placeholder" }]) },
      documentTemplate: { findMany: vi.fn() },
      supportingDocument: { findMany: vi.fn() },
    }

    const findings = await generateUploadReconciliationReport(client as never, {
      now,
      probes: { durableKeyExists: vi.fn().mockResolvedValue(true) },
    })
    expect(findings.map((finding) => finding.category)).toEqual(
      expect.arrayContaining([
        "STALE_INITIATED_OR_RECEIVING",
        "PROMOTION_STUCK",
        "DURABLE_OBJECT_WITHOUT_STORED_OBJECT",
        "CLEANUP_PENDING",
        "PENDING_STORED_OBJECT_WITHOUT_OWNER",
        "LEGACY_PLACEHOLDER",
      ]),
    )
    const report = JSON.stringify(findings)
    expect(report).not.toContain("secret-key")
    expect(report).not.toContain("secret-bucket")
    expect(client.uploadAttempt.findMany).toHaveBeenCalledOnce()
  })
})

