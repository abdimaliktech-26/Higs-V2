// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest"
import { assertTemplateUploadRuntimeAvailable } from "@/lib/uploads/template-upload"

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

afterEach(() => vi.unstubAllEnvs())

describe("PR-5B.2B active-writer capability gate", () => {
  it("allows the writer only when S3, GuardDuty, operational approval, and platform evidence are complete", () => {
    validEnvironment()
    expect(() => assertTemplateUploadRuntimeAvailable()).not.toThrow()
  })

  it("fails closed when the scanner is not operationally approved", () => {
    validEnvironment()
    vi.stubEnv("MALWARE_SCANNER_OPERATIONALLY_APPROVED", "false")
    expect(() => assertTemplateUploadRuntimeAvailable()).toThrow(/temporarily unavailable/i)
  })

  it("fails closed when 25 MB platform limits are unverified", () => {
    validEnvironment()
    vi.stubEnv("UPLOAD_PLATFORM_LIMITS_VERIFIED", "false")
    expect(() => assertTemplateUploadRuntimeAvailable()).toThrow(/temporarily unavailable/i)
  })

  it("rejects local storage even outside production", () => {
    validEnvironment()
    vi.stubEnv("STORAGE_PROVIDER", "local")
    expect(() => assertTemplateUploadRuntimeAvailable()).toThrow(/temporarily unavailable/i)
  })
})
