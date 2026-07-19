"use server"

import { revalidatePath } from "next/cache"
import { validate, saveFieldsSchema, addFieldSchema } from "@/lib/validation"
import { prisma } from "@/lib/db"
import { createAuditEvent } from "@/lib/audit"
import { UserRole } from "@prisma/client"
import { randomUUID } from "node:crypto"
import { getFileStream, signStaffFileUrl, storeFile } from "@/lib/storage"
import { createStorageAdapter, storageKeys } from "@/lib/storage/index"
import { fillPdf } from "@/lib/pdf/fill-pdf"
import { GeneratedPdfStorageError, isDurableGenerationRequired, storeGeneratedPdfDurably } from "@/lib/pdf/store-generated-pdf"
import { Prisma } from "@prisma/client"
import { requireDocumentAccess } from "@/lib/live-authorization"
import {
  reconcilePacketDocumentApplicability,
  buildPacketConditionContext,
  buildPacketConditionContextTx,
  buildEditorDocumentConditionState,
  evaluatePdfFieldVisibility,
  evaluatePdfFieldRequiredness,
} from "@/lib/conditions/runtime"

const EDIT_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

const CONFIGURATION_ERROR_MESSAGE = "This document has a compliance configuration error and cannot be edited until it is resolved."

type ActionResult = { success: true; data: Record<string, unknown> } | { success: false; error: string }

// hasFieldValue mirrors the client's own fieldHasValue truthiness rule
// (pdf-editor-client.tsx) so "no meaningful value" means the same thing on
// both sides — an empty/whitespace-only string does not count as answered.
// Legacy status recalculation intentionally keeps its own, older SQL-level
// `value: null` check unchanged rather than adopting this (see below).
function hasFieldValue(value: string | null | undefined): boolean {
  return typeof value === "string" ? value.trim().length > 0 : Boolean(value)
}

// Step 4c.3b (clear-value fix): Prisma silently omits an `undefined` value
// from an UPDATE's data object, leaving the row's previous value untouched —
// so a submitted `undefined` (representing "cleared") would evaluate as
// empty for THIS request's visibility/requiredness/status decisions but
// never actually clear the stored value in the database, letting evaluation
// and persistence disagree. Normalizing every submitted value through this
// function before it is used for evaluation OR persistence closes that gap
// at the one place it can originate — everything downstream (the prospective
// overlay, the write itself, and every later read of the persisted value by
// status recalculation and reconciliation) then sees the same, correct
// value. An empty string is preserved as an empty string (not further
// coerced to null) — hasFieldValue already treats it, and any
// whitespace-only string, as "no meaningful value" for completion purposes.
function normalizeFieldValue(value: string | null | undefined): string | null {
  return value === undefined ? null : value
}

// ── Step 4c.3a: server-authoritative visibility/requiredness in the editor
// DTO. Condition evaluation is read-only here — no writes, no reconciliation,
// no audit beyond the existing DOCUMENT_VIEWED event. A condition-aware
// packet's field visibility/effective-requiredness is computed once per
// request from buildPacketConditionContext + the packet's immutable
// snapshot; live mutable template conditions are never read for this. A
// legacy packet (no snapshot) always reports every field visible with its
// persisted static requiredness, unchanged from before this step. A
// CONDITIONALLY_INACTIVE document or one with a condition integrity error
// still loads (for historical/inspection access) but is forced read-only —
// neither state blocks the page, and neither ever mutates anything on read.
export async function getEditableDocument(documentId: string) {
  const doc = await prisma.packetDocument.findUnique({
    where: { id: documentId },
    include: {
      documentTemplate: true,
      packet: {
        include: {
          client: { select: { id: true, firstName: true, lastName: true, mcadId: true } },
          program: { select: { name: true } },
          assignedTo: { select: { name: true, email: true } },
        },
      },
      fields: { orderBy: { sortOrder: "asc" } },
      versions: { orderBy: { version: "desc" }, take: 20 },
      comments: {
        orderBy: { createdAt: "desc" },
        take: 50,
        include: { createdBy: { select: { name: true, email: true } } },
      },
    },
  })

  if (!doc) throw new Error("Document not found")
  const authorization = await requireDocumentAccess(documentId, "read", "open staff document editor")
  const role = authorization.role
  const isSuperAdmin = authorization.isGlobalSuperAdmin

  // One buildPacketConditionContext call per request — never per field. Also
  // independently re-verifies organization/parent-chain consistency
  // (packet/client, packet/template, packet/program, and for condition-aware
  // packets, snapshot/organization and snapshot/template identity) before
  // any evaluation runs.
  const runtime = await buildPacketConditionContext(doc.packetId)
  const conditionState = buildEditorDocumentConditionState(
    runtime,
    { id: doc.id, applicabilityStatus: doc.applicabilityStatus, packetTemplateDocumentId: doc.packetTemplateDocumentId },
    doc.fields.map((f) => ({ id: f.id, templateFieldKey: f.templateFieldKey, isRequired: f.isRequired }))
  )

  const isApproved = doc.packet.status === "approved" || doc.packet.status === "archived"
  const isDocumentInactive = doc.applicabilityStatus === "CONDITIONALLY_INACTIVE"
  const roleIsReadOnly = !isSuperAdmin && !EDIT_ROLES.includes(role)
  const isReadOnly = isApproved || roleIsReadOnly || isDocumentInactive || conditionState.hasConditionIntegrityError

  // Priority mirrors severity/actionability: a configuration error and
  // inactivity both need a distinct explanation (they're not the everyday
  // "you don't have edit rights" case); approval-lock and role-based
  // view-only reuse their existing, already-understood meanings.
  const readOnlyReason: string | null = conditionState.hasConditionIntegrityError
    ? "This document has a compliance configuration error and cannot be edited until it is resolved."
    : isDocumentInactive
      ? "This document is currently not applicable based on packet conditions."
      : isApproved
        ? "This document is approved and locked for editing."
        : roleIsReadOnly
          ? "Your role has view-only access to this document."
          : null

  await createAuditEvent({
    organizationId: doc.packet.organizationId,
    actorId: authorization.userId,
    action: "DOCUMENT_VIEWED",
    targetType: "packet_document",
    targetId: documentId,
    metadata: { packetId: doc.packetId, documentName: doc.documentTemplate.name, readOnly: isReadOnly },
  })

  const fields = doc.fields.map((field) => {
    const view = conditionState.fieldsById[field.id]
    return {
      id: field.id,
      name: field.name,
      fieldType: field.fieldType,
      pageNumber: field.pageNumber,
      posX: field.posX,
      posY: field.posY,
      width: field.width,
      height: field.height,
      value: field.value,
      source: field.source,
      sortOrder: field.sortOrder,
      confidence: field.confidence,
      // Preserved verbatim, unchanged — the current editor client still
      // reads this directly; removing it before Step 4c.3c ships the UI
      // that reads staticRequired/effectiveRequired instead would break it.
      isRequired: field.isRequired,
      staticRequired: field.isRequired,
      effectiveRequired: view.effectiveRequired,
      isVisible: view.isVisible,
      templateFieldKey: field.templateFieldKey,
      conditionallyRequired: view.conditionallyRequired,
      visibilityConditionPresent: view.visibilityConditionPresent,
      requirednessConditionPresent: view.requirednessConditionPresent,
    }
  })

  return {
    ...doc,
    fields,
    isReadOnly,
    readOnlyReason,
    isLockedByApproval: isApproved,
    applicabilityStatus: doc.applicabilityStatus,
    conditionMode: conditionState.conditionMode,
    isConditionAware: conditionState.isConditionAware,
    hasConditionIntegrityError: conditionState.hasConditionIntegrityError,
    conditionIntegrityErrorCount: conditionState.conditionIntegrityErrorCount,
    conditionConfigurationError: conditionState.hasConditionIntegrityError,
    reconciliationPending: conditionState.reconciliationPending,
    pdfUrl: doc.documentTemplate.fileKey ? signStaffFileUrl("packet_document", doc.id) : null,
    versions: doc.versions.map((v) => ({
      ...v,
      signedUrl: v.fileKey ? signStaffFileUrl("pdf_version", v.id) : null,
    })),
  }
}

// ── Step 4c.3b: transactional save enforcement and condition-aware status
// recalculation. Field writes, prospective visibility/requiredness
// evaluation, the edited document's status recalculation, applicability
// reconciliation, and the audit event all commit together or not at all —
// a failure anywhere (including a condition integrity error) rolls back the
// whole save, leaving prior field values, document status, and applicability
// completely untouched. A submitted write to a field that evaluates hidden
// in the PROSPECTIVE state (persisted values overlaid with this same
// submission) is silently excluded from the write set rather than failing
// the whole save — the current editor client always resubmits every field's
// current value, including untouched hidden ones, so rejecting the batch
// outright would make it impossible to save a condition-aware document at
// all before a later step ships client-side filtering. Legacy packets (no
// condition snapshot) are entirely unaffected: every submitted field is
// accepted and status recalculates from static isRequired, exactly as
// before this step.
export async function saveDocumentFields(
  documentId: string,
  fields: { id?: string; name: string; fieldType: string; value?: string; pageNumber: number; posX?: number; posY?: number; isRequired: boolean }[]
): Promise<ActionResult> {
  try {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: true },
    })
    if (!doc) return { success: false, error: "Document not found" }
    const authorization = await requireDocumentAccess(documentId, "write", "save document fields")

    // Server-side read-only enforcement — never rely on the client disabling
    // its Save button. Checked before the transaction even opens, since
    // these reject the entire save regardless of what was submitted.
    if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
      return { success: false, error: "This document is currently not applicable based on packet conditions and cannot be edited." }
    }
    if (doc.packet.status === "approved" || doc.packet.status === "archived") {
      return { success: false, error: "This document is approved and locked for editing." }
    }

    const isConditionAware = Boolean(doc.packet.conditionSnapshotId && doc.packet.conditionRuntimeVersion)

    const result = await prisma.$transaction(async (tx) => {
      // Field ownership — every submitted existing-field id must belong to
      // THIS document. Rejects cross-document, cross-packet, and
      // cross-tenant field ids in one pass (the document itself was already
      // verified to belong to the caller's organization above). Fetches the
      // fields' own persisted templateFieldKey/value/isRequired/source too —
      // needed to build the prospective overlay below; never taken from
      // anything the client submitted.
      const existingFields = await tx.pdfField.findMany({
        where: { packetDocumentId: documentId },
        select: { id: true, templateFieldKey: true, value: true, isRequired: true, source: true },
      })
      const existingFieldsById = new Map(existingFields.map((f) => [f.id, f]))
      for (const f of fields) {
        if (f.id && !existingFieldsById.has(f.id)) throw new Error("One or more fields do not belong to this document")
      }

      let acceptedFields = fields
      const ignoredFieldIds: string[] = []

      if (isConditionAware) {
        // Prospective state: persisted values overlaid with this submission,
        // keyed strictly by the field's own trusted (ownership-verified) id
        // — the fieldKey each value lands on on is always resolved from the
        // field's own persisted templateFieldKey, never from anything the
        // client claims. A packet-wide integrity error rejects the entire
        // save immediately — before any field is written — rather than
        // letting individual fields silently fall back to visible/optional.
        const overlayValues: Record<string, string | null> = {}
        for (const f of fields) {
          if (f.id) overlayValues[f.id] = normalizeFieldValue(f.value)
        }
        const prospectiveRuntime = await buildPacketConditionContextTx(tx, doc.packetId, {
          packetDocumentId: documentId,
          fieldValues: overlayValues,
        })
        if (prospectiveRuntime.integrityErrors.length > 0) throw new Error(CONFIGURATION_ERROR_MESSAGE)

        acceptedFields = fields.filter((f) => {
          if (!f.id) return true // new manual field — always visible, no template identity
          const visibility = evaluatePdfFieldVisibility(prospectiveRuntime, documentId, f.id)
          const isVisible = visibility.status === "evaluated" ? visibility.result : false
          if (!isVisible) {
            ignoredFieldIds.push(f.id)
            return false
          }
          return true
        })
      }

      // Accepted writes only — existing fields may only ever have value/
      // posX/posY changed here; templateFieldKey, documentTemplateFieldId,
      // static isRequired, source, and ownership links are never touched by
      // this path (unchanged from before this step). New manual fields keep
      // their existing shape: source "manual", no template identity, always
      // visible, and their submitted isRequired becomes their static
      // requirement.
      for (const f of acceptedFields) {
        if (f.id) {
          // normalizeFieldValue ensures an explicitly-cleared (undefined)
          // submission is actually persisted as null — Prisma would
          // otherwise silently omit the column from the UPDATE and leave
          // the previous value in place.
          await tx.pdfField.update({ where: { id: f.id }, data: { value: normalizeFieldValue(f.value), posX: f.posX, posY: f.posY } })
        } else {
          await tx.pdfField.create({
            data: {
              packetDocumentId: documentId, name: f.name, fieldType: f.fieldType,
              value: normalizeFieldValue(f.value), pageNumber: f.pageNumber, posX: f.posX, posY: f.posY,
              isRequired: f.isRequired, source: "manual", confidence: 1.0,
            },
          })
        }
      }

      let newStatus: string
      if (isConditionAware) {
        // Re-evaluate from the now-committed (within this same transaction)
        // accepted state — ignored fields kept their prior, already-correct
        // stored values, so no overlay is needed here. A hidden field or a
        // conditionally-optional field never counts as pending; zero
        // visible-and-effectively-required fields means completed.
        const finalRuntime = await buildPacketConditionContextTx(tx, doc.packetId)
        if (finalRuntime.integrityErrors.length > 0) throw new Error(CONFIGURATION_ERROR_MESSAGE)

        // Read the mapping id from the freshly tx-fetched runtime, not the
        // outer pre-transaction `doc` — this document's own trusted identity
        // as of right now, inside this same transaction.
        const mappingId = finalRuntime.packetDocumentsById[documentId]?.packetTemplateDocumentId
        const documentEntry = mappingId ? finalRuntime.packetDocumentsByMappingId[mappingId] : undefined
        if (!documentEntry) throw new Error("Packet document cannot be resolved to the snapshot")

        const pendingRequired = Object.values(documentEntry.fieldsById).filter((field) => {
          const visibility = evaluatePdfFieldVisibility(finalRuntime, documentId, field.id)
          const requiredness = evaluatePdfFieldRequiredness(finalRuntime, documentId, field.id)
          const isVisible = visibility.status === "evaluated" ? visibility.result : false
          const effectiveRequired = requiredness.status === "evaluated" ? requiredness.result : false
          return isVisible && effectiveRequired && !hasFieldValue(field.value)
        }).length
        newStatus = pendingRequired === 0 ? "completed" : "in_progress"
      } else {
        // Static requiredness only — unchanged from before Step 4c.2b.
        const pendingRequired = await tx.pdfField.count({
          where: { packetDocumentId: documentId, isRequired: true, value: null },
        })
        newStatus = pendingRequired === 0 ? "completed" : "in_progress"
      }
      await tx.packetDocument.update({ where: { id: documentId }, data: { status: newStatus } })

      await createAuditEvent({
        organizationId: doc.packet.organizationId,
        actorId: authorization.userId,
        action: "DOCUMENT_SAVED",
        targetType: "packet_document",
        targetId: documentId,
        metadata: { acceptedFieldCount: acceptedFields.length, ignoredFieldCount: ignoredFieldIds.length, status: newStatus },
      }, tx)

      if (isConditionAware) {
        await reconcilePacketDocumentApplicability(tx, doc.packet.id, authorization.userId)
      }

      return { status: newStatus, ignoredFieldIds }
    })

    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: result }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

// ── Step 4c.3c.2: debounced, read-only condition evaluation for the editor's
// real-time hide/show and conditional-requiredness feedback. Deliberately
// NOT a variant of saveDocumentFields — no field ownership write path, no
// status recalculation, no reconciliation, no audit event, no database
// mutation of any kind. Reuses the exact same trusted building blocks the
// save path already uses (normalizeFieldValue, buildPacketConditionContext
// with an overlay, buildEditorDocumentConditionState) so evaluation semantics
// can never drift between "what the client sees while typing" and "what the
// server actually enforces on save." The response is deliberately narrow —
// only isVisible/effectiveRequired/conditionallyRequired per field id, never
// the condition trees, field keys, operators, comparison values, or any
// snapshot/runtime detail those booleans were derived from.
export async function evaluateDocumentFieldConditions(
  documentId: string,
  fields: { id: string; value?: string | null }[]
): Promise<ActionResult> {
  try {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: true },
    })
    if (!doc) return { success: false, error: "Document not found" }
    await requireDocumentAccess(documentId, "write", "evaluate document field conditions")

    // Same read-only gate as saveDocumentFields — a document the editor
    // wouldn't let anyone type into shouldn't be evaluated either.
    if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE") {
      return { success: false, error: "This document is currently not applicable based on packet conditions and cannot be edited." }
    }
    if (doc.packet.status === "approved" || doc.packet.status === "archived") {
      return { success: false, error: "This document is approved and locked for editing." }
    }

    const isConditionAware = Boolean(doc.packet.conditionSnapshotId && doc.packet.conditionRuntimeVersion)
    if (!isConditionAware) {
      // Legacy documents have nothing to evaluate — every field is already
      // visible with its static requiredness, unchanged. The client is not
      // expected to call this for a legacy document at all, but a defensive
      // call still returns a safe, empty, correct result rather than an error.
      return { success: true, data: { fields: {} } }
    }

    // Field ownership — every submitted id must belong to THIS document.
    // Fetched with the exact fields buildEditorDocumentConditionState needs,
    // so this single query also serves as the evaluation input.
    const existingFields = await prisma.pdfField.findMany({
      where: { packetDocumentId: documentId },
      select: { id: true, templateFieldKey: true, isRequired: true },
    })
    const existingFieldIds = new Set(existingFields.map((f) => f.id))
    for (const f of fields) {
      if (!existingFieldIds.has(f.id)) return { success: false, error: "One or more fields do not belong to this document" }
    }

    const overlayValues: Record<string, string | null> = {}
    for (const f of fields) overlayValues[f.id] = normalizeFieldValue(f.value)

    const runtime = await buildPacketConditionContext(doc.packetId, { packetDocumentId: documentId, fieldValues: overlayValues })
    if (runtime.integrityErrors.length > 0) return { success: false, error: CONFIGURATION_ERROR_MESSAGE }

    const conditionState = buildEditorDocumentConditionState(
      runtime,
      { id: documentId, applicabilityStatus: doc.applicabilityStatus, packetTemplateDocumentId: doc.packetTemplateDocumentId },
      existingFields.map((f) => ({ id: f.id, templateFieldKey: f.templateFieldKey, isRequired: f.isRequired }))
    )
    if (conditionState.hasConditionIntegrityError) return { success: false, error: CONFIGURATION_ERROR_MESSAGE }

    const result: Record<string, { isVisible: boolean; effectiveRequired: boolean; conditionallyRequired: boolean }> = {}
    for (const [fieldId, view] of Object.entries(conditionState.fieldsById)) {
      result[fieldId] = { isVisible: view.isVisible, effectiveRequired: view.effectiveRequired, conditionallyRequired: view.conditionallyRequired }
    }

    return { success: true, data: { fields: result } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function addPdfField(data: {
  packetDocumentId: string; name: string; fieldType: string; pageNumber: number
}): Promise<ActionResult> {
  try {
    const doc = await prisma.packetDocument.findUnique({ where: { id: data.packetDocumentId }, include: { packet: true } })
    if (!doc) return { success: false, error: "Not found" }
    const authorization = await requireDocumentAccess(data.packetDocumentId, "write", "add document field")
    if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE" || ["approved", "archived"].includes(doc.packet.status)) {
      return { success: false, error: "This document is locked for editing" }
    }

    const field = await prisma.pdfField.create({
      data: { packetDocumentId: data.packetDocumentId, name: data.name, fieldType: data.fieldType, pageNumber: data.pageNumber, source: "manual" },
    })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: authorization.userId,
      action: "DOCUMENT_FIELD_ADDED",
      targetType: "pdf_field",
      targetId: field.id,
      metadata: { fieldName: data.name, documentId: data.packetDocumentId },
    })
    revalidatePath(`/documents/${data.packetDocumentId}/edit`)
    return { success: true, data: { id: field.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function updatePdfField(fieldId: string, data: { value?: string; posX?: number; posY?: number }): Promise<ActionResult> {
  try {
    const field = await prisma.pdfField.findUnique({ where: { id: fieldId }, include: { packetDocument: { include: { packet: true } } } })
    if (!field) return { success: false, error: "Not found" }
    const authorization = await requireDocumentAccess(field.packetDocumentId, "write", "update document field")
    if (field.packetDocument.applicabilityStatus === "CONDITIONALLY_INACTIVE" || ["approved", "archived"].includes(field.packetDocument.packet.status)) {
      return { success: false, error: "This document is locked for editing" }
    }

    await prisma.pdfField.update({ where: { id: fieldId }, data })

    await createAuditEvent({
      organizationId: field.packetDocument.packet.organizationId,
      actorId: authorization.userId,
      action: "DOCUMENT_FIELD_UPDATED",
      targetType: "pdf_field",
      targetId: fieldId,
      metadata: { fieldName: field.name, documentId: field.packetDocumentId },
    })
    return { success: true, data: { id: fieldId } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

export async function createPdfVersion(documentId: string, comment?: string): Promise<ActionResult> {
  try {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: {
        packet: true,
        documentTemplate: true,
        fields: { orderBy: { sortOrder: "asc" } },
        signatureRequests: { where: { status: "signed" }, select: { pdfFieldId: true, signerName: true, signedAt: true } },
      },
    })
    if (!doc) return { success: false, error: "Not found" }
    const authorization = await requireDocumentAccess(documentId, "write", "create document version")
    if (doc.applicabilityStatus === "CONDITIONALLY_INACTIVE" || ["approved", "archived"].includes(doc.packet.status)) {
      return { success: false, error: "This document is locked for editing" }
    }

    // Render the completed document onto a copy of the pristine template.
    // Condition-hidden fields are excluded exactly as the editor hides them;
    // the blank template object itself is never modified.
    const runtime = await buildPacketConditionContext(doc.packetId)
    const conditionState = buildEditorDocumentConditionState(
      runtime,
      { id: doc.id, applicabilityStatus: doc.applicabilityStatus, packetTemplateDocumentId: doc.packetTemplateDocumentId },
      doc.fields.map((f) => ({ id: f.id, templateFieldKey: f.templateFieldKey, isRequired: f.isRequired }))
    )
    const visibleFields = doc.fields.filter((field) => conditionState.fieldsById[field.id]?.isVisible !== false)
    const template = await getFileStream(doc.documentTemplate.fileKey)
    if (!template) return { success: false, error: "The blank template file is unavailable" }
    let templateBytes: Buffer
    try {
      templateBytes = Buffer.from(await template.stream.readFile())
    } finally {
      await template.stream.close()
    }
    const signaturesByFieldId = new Map(
      doc.signatureRequests
        .filter((request) => request.pdfFieldId && request.signedAt)
        .map((request) => [request.pdfFieldId as string, { signerName: request.signerName, signedAt: request.signedAt as Date }])
    )
    const filledBytes = await fillPdf({
      templatePdf: new Uint8Array(templateBytes),
      fields: visibleFields,
      fieldIds: visibleFields.map((field) => field.id),
      signaturesByFieldId,
    })

    const nextVersion = doc.currentVersion + 1
    const generatedBytes = Buffer.from(filledBytes)
    const pdfVersionId = randomUUID()

    // S3-configured environments MUST store the generated artifact durably;
    // a failed or unverified durable write creates no records and never
    // silently downgrades to local-only generation. Development without S3
    // keeps the existing local-compatibility behavior.
    let durable: Awaited<ReturnType<typeof storeGeneratedPdfDurably>> | null = null
    if (isDurableGenerationRequired()) {
      const durableKey = storageKeys.packetDocumentVersion({
        organizationId: doc.packet.organizationId,
        clientId: doc.packet.clientId,
        packetId: doc.packetId,
        packetDocumentId: documentId,
        pdfVersionId,
      })
      durable = await storeGeneratedPdfDurably(createStorageAdapter(), durableKey, generatedBytes)
    }

    // Temporary PR-5C.3 compatibility copy. Once the durable write has
    // succeeded, a compatibility-copy failure must not invalidate the
    // authoritative record — linked rows are served from the StoredObject,
    // never the local copy. Without S3, the local copy IS the record and its
    // failure aborts generation exactly as before.
    const compatibilityKey = `documents/${documentId}/v${nextVersion}.pdf`
    let compatibility: { key: string; url: string; size: number } | null = null
    try {
      compatibility = await storeFile(compatibilityKey, generatedBytes, "application/pdf", `${doc.documentTemplate.name} v${nextVersion}.pdf`)
    } catch {
      if (!durable) return { success: false, error: "Failed to store the generated document" }
    }

    try {
      await prisma.$transaction(async (tx) => {
        let storedObjectId: string | null = null
        if (durable) {
          const storedObject = await tx.storedObject.create({
            data: {
              organizationId: doc.packet.organizationId,
              provider: "S3",
              bucket: durable.bucket,
              objectKey: durable.objectKey,
              objectVersionId: durable.objectVersionId,
              etag: durable.etag ?? null,
              checksumSha256: durable.checksumSha256,
              sizeBytes: BigInt(durable.sizeBytes),
              mimeType: "application/pdf",
              originalFileName: null,
              encryptionKeyRef: durable.encryptionKeyRef,
              lifecycleStatus: "AVAILABLE",
              // Honest classification: generated internally, never scanned as
              // an external upload; must never be represented as CLEAN.
              malwareStatus: "NOT_SCANNED",
              immutable: false,
              legalHold: false,
            },
          })
          storedObjectId = storedObject.id
        }
        await tx.pdfVersion.create({
          data: {
            id: pdfVersionId,
            packetDocumentId: documentId,
            version: nextVersion,
            fileUrl: compatibility?.url ?? "",
            fileKey: compatibility?.key ?? compatibilityKey,
            fileSize: durable?.sizeBytes ?? compatibility?.size ?? generatedBytes.length,
            comment: comment || `Version ${nextVersion}`,
            createdById: authorization.userId,
            storedObjectId,
          },
        })
        await tx.packetDocument.update({ where: { id: documentId }, data: { currentVersion: nextVersion } })
        // Strict audit: a failed audit write rolls back every authoritative row.
        await tx.auditEvent.create({
          data: {
            organizationId: doc.packet.organizationId,
            actorId: authorization.userId,
            action: "PDF_VERSION_CREATED",
            targetType: "packet_document",
            targetId: documentId,
            metadata: { version: nextVersion, documentName: doc.documentTemplate.name },
          },
        })
      })
    } catch (error) {
      // A rolled-back transaction leaves at most an unowned durable artifact,
      // which reconciliation reports; no PdfVersion or owned StoredObject exists.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return { success: false, error: "A version was just created for this document. Refresh and try again." }
      }
      throw error
    }

    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: { version: nextVersion } }
  } catch (e) {
    if (e instanceof GeneratedPdfStorageError) return { success: false, error: e.message }
    return { success: false, error: (e as Error).message }
  }
}

export async function addDocumentComment(documentId: string, text: string): Promise<ActionResult> {
  try {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: true },
    })
    if (!doc) return { success: false, error: "Not found" }
    const authorization = await requireDocumentAccess(documentId, "write", "add document comment")

    const comment = await prisma.documentComment.create({
      data: { packetDocumentId: documentId, text, createdById: authorization.userId },
    })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: authorization.userId,
      action: "DOCUMENT_COMMENT_ADDED",
      targetType: "document_comment",
      targetId: comment.id,
      metadata: { documentId },
    })
    revalidatePath(`/documents/${documentId}/edit`)
    return { success: true, data: { id: comment.id } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}

/**
 * Narrow, single-document portal-sharing toggle — no bulk sharing, no
 * auto-sharing of an entire packet. Disabling immediately removes portal
 * access to this specific document (portalVisible defaults false and is
 * only ever flipped true by this explicit, per-document staff action).
 */
export async function setPacketDocumentPortalVisibility(
  documentId: string,
  input: { portalVisible: boolean; portalAccessLevel?: "VIEW" | "VIEW_AND_DOWNLOAD" }
): Promise<ActionResult> {
  try {
    const doc = await prisma.packetDocument.findUnique({
      where: { id: documentId },
      include: { packet: { select: { organizationId: true } } },
    })
    if (!doc) return { success: false, error: "Not found" }
    const authorization = await requireDocumentAccess(documentId, "write", "change document portal visibility")

    const updated = await prisma.packetDocument.update({
      where: { id: documentId },
      data: input.portalVisible
        ? {
            portalVisible: true,
            portalVisibleAt: new Date(),
            sharedByUserId: authorization.userId,
            portalAccessLevel: input.portalAccessLevel || "VIEW",
          }
        : {
            portalVisible: false,
            portalVisibleAt: null,
            sharedByUserId: null,
            portalAccessLevel: null,
          },
    })

    await createAuditEvent({
      organizationId: doc.packet.organizationId,
      actorId: authorization.userId,
      action: "DOCUMENT_PORTAL_VISIBILITY_CHANGED",
      targetType: "packet_document",
      targetId: documentId,
      metadata: { portalVisible: input.portalVisible, portalAccessLevel: updated.portalAccessLevel },
    })

    revalidatePath(`/packets/${doc.packetId}`)
    return { success: true, data: { id: documentId, portalVisible: updated.portalVisible } }
  } catch (e) {
    return { success: false, error: (e as Error).message }
  }
}
