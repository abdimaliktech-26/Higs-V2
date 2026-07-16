import {
  StoredObjectMalwareStatus,
  UploadScannerProvider,
  UploadStatus,
  type Prisma,
} from "@prisma/client"
import { prisma } from "../db"
import { validateStorageKey } from "../storage/keys"
import { UploadScanEventError } from "./errors"
import { recordScannerResult } from "./lifecycle"
import type { UploadScannerConfiguration } from "./config"

const MAX_EVENT_BYTES = 64 * 1024
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const RESULT_VALUES = ["NO_THREATS_FOUND", "THREATS_FOUND", "UNSUPPORTED", "ACCESS_DENIED", "FAILED"] as const

export type GuardDutyScanResultStatus = (typeof RESULT_VALUES)[number]

export interface GuardDutyScanResultEvent {
  eventId: string
  accountId: string
  region: string
  occurredAt: Date
  bucket: string
  objectKey: string
  objectVersionId: string
  etag: string
  resultStatus: GuardDutyScanResultStatus
}

export type GuardDutyScanProcessingDisposition =
  | "RECORDED_CLEAN"
  | "RECORDED_FAILED"
  | "ACK_DUPLICATE"
  | "ACK_TERMINAL"

interface GuardDutyEventShape {
  version?: unknown
  id?: unknown
  source?: unknown
  account?: unknown
  time?: unknown
  region?: unknown
  resources?: unknown
  "detail-type"?: unknown
  detail?: {
    schemaVersion?: unknown
    scanStatus?: unknown
    resourceType?: unknown
    s3ObjectDetails?: {
      bucketName?: unknown
      objectKey?: unknown
      eTag?: unknown
      versionId?: unknown
    }
    scanResultDetails?: { scanResultStatus?: unknown }
  }
}

function invalid(message: string): never {
  throw new UploadScanEventError("INVALID_EVENT", message)
}

function untrusted(message: string): never {
  throw new UploadScanEventError("UNTRUSTED_EVENT", message)
}

/**
 * Parses only the bounded GuardDuty fields needed for state transition. Threat
 * names, status reasons, object contents, and raw provider payloads are never
 * returned or persisted.
 */
export function parseGuardDutyScanResultEvent(
  body: string,
  configuration: UploadScannerConfiguration,
): GuardDutyScanResultEvent {
  if (Buffer.byteLength(body, "utf8") > MAX_EVENT_BYTES) invalid("The scanner event exceeds the accepted size.")
  if (configuration.provider !== "guardduty-s3" || configuration.errors.length > 0) {
    untrusted("GuardDuty scanner configuration is unavailable.")
  }

  let value: GuardDutyEventShape
  try {
    value = JSON.parse(body) as GuardDutyEventShape
  } catch {
    invalid("The scanner event is not valid JSON.")
  }

  if (
    value.version !== "0"
    || value.source !== "aws.guardduty"
    || value["detail-type"] !== "GuardDuty Malware Protection Object Scan Result"
    || value.detail?.schemaVersion !== "1.0"
    || value.detail.resourceType !== "S3_OBJECT"
  ) invalid("The scanner event type is not supported.")

  if (typeof value.id !== "string" || !EVENT_ID.test(value.id)) invalid("The scanner event identifier is invalid.")
  if (value.account !== configuration.expectedAwsAccountId || value.region !== configuration.expectedRegion) {
    untrusted("The scanner event account or region is not trusted.")
  }
  if (!Array.isArray(value.resources) || !value.resources.includes(configuration.malwareProtectionPlanArn)) {
    untrusted("The scanner event protection plan is not trusted.")
  }

  const occurredAt = typeof value.time === "string" ? new Date(value.time) : new Date(Number.NaN)
  if (Number.isNaN(occurredAt.getTime())) invalid("The scanner event timestamp is invalid.")

  const object = value.detail.s3ObjectDetails
  const scanStatus = value.detail.scanStatus
  const result = value.detail.scanResultDetails?.scanResultStatus
  if (
    !object
    || typeof object.bucketName !== "string"
    || typeof object.objectKey !== "string"
    || typeof object.versionId !== "string"
    || !object.versionId
    || typeof object.eTag !== "string"
    || !object.eTag
    || typeof result !== "string"
    || !(RESULT_VALUES as readonly string[]).includes(result)
  ) invalid("The scanner event object identity or result is incomplete.")
  if (object.bucketName !== configuration.quarantineBucket) {
    untrusted("The scanner event bucket is not the configured quarantine bucket.")
  }
  const statusMatchesResult = scanStatus === "COMPLETED"
    ? result === "NO_THREATS_FOUND" || result === "THREATS_FOUND"
    : scanStatus === "SKIPPED"
      ? result === "UNSUPPORTED" || result === "ACCESS_DENIED"
      : scanStatus === "FAILED" && result === "FAILED"
  if (!statusMatchesResult) invalid("The scanner status and result do not form an accepted pair.")

  try {
    validateStorageKey(object.objectKey)
  } catch {
    invalid("The scanner event object key is invalid.")
  }

  return {
    eventId: value.id,
    accountId: value.account as string,
    region: value.region as string,
    occurredAt,
    bucket: object.bucketName,
    objectKey: object.objectKey,
    objectVersionId: object.versionId,
    etag: object.eTag.replace(/^"|"$/g, ""),
    resultStatus: result as GuardDutyScanResultStatus,
  }
}

type ScanEventClient = Pick<Prisma.TransactionClient, "uploadAttempt">
type ScanEventDatabase = Pick<typeof prisma, "$transaction">

async function applyGuardDutyResult(
  event: GuardDutyScanResultEvent,
  client: ScanEventClient,
  receivedAt: Date,
): Promise<GuardDutyScanProcessingDisposition> {
  const previouslyRecorded = await client.uploadAttempt.findFirst({
    where: {
      scannerProvider: UploadScannerProvider.GUARDDUTY_S3,
      scannerReference: event.eventId,
    },
  })
  if (previouslyRecorded) {
    const sameObject = previouslyRecorded.quarantineProvider === "S3"
      && previouslyRecorded.quarantineBucket === event.bucket
      && previouslyRecorded.quarantineObjectKey === event.objectKey
      && previouslyRecorded.quarantineObjectVersionId === event.objectVersionId
      && (!previouslyRecorded.quarantineEtag || previouslyRecorded.quarantineEtag.replace(/^"|"$/g, "") === event.etag)
    if (!sameObject) throw new UploadScanEventError("EVENT_CONFLICT", "The scanner event identity is already bound to another object.")
    return "ACK_DUPLICATE"
  }

  const attempt = await client.uploadAttempt.findFirst({
    where: {
      quarantineProvider: "S3",
      quarantineBucket: event.bucket,
      quarantineObjectKey: event.objectKey,
      quarantineObjectVersionId: event.objectVersionId,
    },
  })
  if (!attempt) {
    throw new UploadScanEventError("ATTEMPT_NOT_READY", "The matching upload attempt is not ready.", true)
  }
  if (attempt.quarantineEtag && attempt.quarantineEtag.replace(/^"|"$/g, "") !== event.etag) {
    throw new UploadScanEventError("EVENT_CONFLICT", "The scanner event does not match the quarantined object metadata.")
  }
  if (
    event.occurredAt.getTime() > receivedAt.getTime() + MAX_CLOCK_SKEW_MS
    || (attempt.quarantinedAt && event.occurredAt.getTime() < attempt.quarantinedAt.getTime() - MAX_CLOCK_SKEW_MS)
  ) {
    throw new UploadScanEventError("EVENT_CONFLICT", "The scanner event timestamp is inconsistent with the upload lifecycle.")
  }
  if (attempt.scannerReference) {
    throw new UploadScanEventError("EVENT_CONFLICT", "A different scanner result is already recorded.")
  }
  if (attempt.status === UploadStatus.FAILED || attempt.status === UploadStatus.COMPLETED) return "ACK_TERMINAL"
  if (
    attempt.status === UploadStatus.PROMOTING
    || attempt.status === UploadStatus.PROMOTED
    || attempt.status === UploadStatus.LINKING
    || attempt.status === UploadStatus.LINKED_CLEANUP_PENDING
  ) {
    throw new UploadScanEventError("EVENT_CONFLICT", "The upload attempt has moved beyond the scanner-result stage.")
  }
  if (
    attempt.status !== UploadStatus.SCANNING
    || attempt.scannerProvider !== UploadScannerProvider.GUARDDUTY_S3
    || attempt.malwareStatus !== StoredObjectMalwareStatus.PENDING
  ) {
    throw new UploadScanEventError("ATTEMPT_NOT_READY", "The upload attempt has not reached the scanner-result stage.", true)
  }

  const outcome = event.resultStatus === "NO_THREATS_FOUND"
    ? "CLEAN"
    : event.resultStatus === "THREATS_FOUND"
      ? "INFECTED"
      : "ERROR"
  await recordScannerResult(
    attempt.id,
    { outcome, scannedAt: event.occurredAt, scannerReference: event.eventId },
    client,
    {
      provider: UploadScannerProvider.GUARDDUTY_S3,
      reference: event.eventId,
      receivedAt,
    },
  )
  return outcome === "CLEAN" ? "RECORDED_CLEAN" : "RECORDED_FAILED"
}

/**
 * SQS worker boundary. The caller must delete the SQS message only after this
 * resolves. Retryable errors keep the message for a later visibility cycle;
 * invalid or conflicting events belong in the configured dead-letter queue.
 */
export async function processGuardDutySqsMessage(
  body: string,
  configuration: UploadScannerConfiguration,
  database: ScanEventDatabase = prisma,
  receivedAt = new Date(),
): Promise<GuardDutyScanProcessingDisposition> {
  const event = parseGuardDutyScanResultEvent(body, configuration)
  return database.$transaction((tx) => applyGuardDutyResult(event, tx, receivedAt))
}
