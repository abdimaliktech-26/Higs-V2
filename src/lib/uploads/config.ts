export type UploadScannerProviderConfiguration = "disabled" | "guardduty-s3"

export interface UploadScannerEnvironment {
  MALWARE_SCANNER_PROVIDER?: string
  GUARDDUTY_EXPECTED_AWS_ACCOUNT_ID?: string
  GUARDDUTY_EXPECTED_REGION?: string
  GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN?: string
  GUARDDUTY_SCAN_QUEUE_URL?: string
  S3_QUARANTINE_BUCKET?: string
  AWS_REGION?: string
  MALWARE_SCANNER_OPERATIONALLY_APPROVED?: string
  UPLOAD_PLATFORM_LIMITS_VERIFIED?: string
}

export interface UploadScannerConfiguration {
  provider: UploadScannerProviderConfiguration
  expectedAwsAccountId?: string
  expectedRegion?: string
  malwareProtectionPlanArn?: string
  scanQueueUrl?: string
  quarantineBucket?: string
  operationallyApproved: boolean
  platformLimitsVerified: boolean
  errors: string[]
}

const PLACEHOLDER_MARKERS = ["change-me", "your-", "example", "placeholder"]
const AWS_ACCOUNT_ID = /^\d{12}$/
const AWS_REGION = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/

function isApproved(value: string | undefined): boolean {
  return value === "true"
}

function isPresent(value: string | undefined): value is string {
  if (!value?.trim()) return false
  const normalized = value.toLowerCase()
  return !PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
}

function validQueueUrl(value: string, region: string, accountId: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === "https:"
      && url.hostname === `sqs.${region}.amazonaws.com`
      && url.pathname.split("/").filter(Boolean)[0] === accountId
      && url.pathname.split("/").filter(Boolean).length === 2
  } catch {
    return false
  }
}

export function readUploadScannerConfiguration(
  env: UploadScannerEnvironment = process.env as UploadScannerEnvironment,
): UploadScannerConfiguration {
  const errors: string[] = []
  const provider = env.MALWARE_SCANNER_PROVIDER === "guardduty-s3"
    ? "guardduty-s3"
    : "disabled"

  if (env.MALWARE_SCANNER_PROVIDER && !(env.MALWARE_SCANNER_PROVIDER === "disabled" || env.MALWARE_SCANNER_PROVIDER === "guardduty-s3")) {
    errors.push("MALWARE_SCANNER_PROVIDER must be disabled or guardduty-s3")
  }

  const accountId = env.GUARDDUTY_EXPECTED_AWS_ACCOUNT_ID
  const region = env.GUARDDUTY_EXPECTED_REGION
  const planArn = env.GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN
  const queueUrl = env.GUARDDUTY_SCAN_QUEUE_URL
  const quarantineBucket = env.S3_QUARANTINE_BUCKET

  if (provider === "guardduty-s3") {
    if (!accountId || !AWS_ACCOUNT_ID.test(accountId)) errors.push("GUARDDUTY_EXPECTED_AWS_ACCOUNT_ID must be a 12-digit AWS account ID")
    if (!region || !AWS_REGION.test(region)) errors.push("GUARDDUTY_EXPECTED_REGION must be a valid AWS region")
    if (env.AWS_REGION && region !== env.AWS_REGION) errors.push("GUARDDUTY_EXPECTED_REGION must match AWS_REGION")
    const planPattern = accountId && region
      ? new RegExp(`^arn:aws:guardduty:${region}:${accountId}:malware-protection-plan/[A-Za-z0-9]+$`)
      : null
    if (!isPresent(planArn) || !planPattern?.test(planArn)) {
      errors.push("GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN must match the configured account and region")
    }
    if (!isPresent(queueUrl) || !accountId || !region || !validQueueUrl(queueUrl, region, accountId)) {
      errors.push("GUARDDUTY_SCAN_QUEUE_URL must be a regional HTTPS SQS queue URL for the configured account")
    }
    if (!isPresent(quarantineBucket)) errors.push("S3_QUARANTINE_BUCKET must identify the protected quarantine bucket")
  }

  return {
    provider,
    expectedAwsAccountId: accountId,
    expectedRegion: region,
    malwareProtectionPlanArn: planArn,
    scanQueueUrl: queueUrl,
    quarantineBucket,
    operationallyApproved: isApproved(env.MALWARE_SCANNER_OPERATIONALLY_APPROVED),
    platformLimitsVerified: isApproved(env.UPLOAD_PLATFORM_LIMITS_VERIFIED),
    errors,
  }
}
