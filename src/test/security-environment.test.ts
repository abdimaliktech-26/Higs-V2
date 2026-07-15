import { describe, expect, it } from "vitest"
import { productionSecurityEnvironmentErrors } from "@/lib/security-environment"

const validStorage = {
  STORAGE_PROVIDER: "s3",
  AWS_REGION: "us-east-2",
  S3_DURABLE_BUCKET: "higsi-production-durable",
  S3_QUARANTINE_BUCKET: "higsi-production-quarantine",
  S3_KMS_KEY_ARN: "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012",
  S3_SIGNED_URL_TTL_SECONDS: "60",
}

describe("production security environment", () => {
  it("does not require deployment secrets outside production", () => {
    expect(productionSecurityEnvironmentErrors({}, "test")).toEqual([])
  })

  it("requires both stable secrets in production", () => {
    expect(productionSecurityEnvironmentErrors(validStorage, "production")).toEqual([
      "AUTH_SECRET must be a non-placeholder value of at least 32 characters",
      "FILE_SIGNING_KEY must be a non-placeholder value of at least 32 characters",
    ])
  })

  it("rejects short and documented placeholder values", () => {
    expect(productionSecurityEnvironmentErrors({
      AUTH_SECRET: "short",
      FILE_SIGNING_KEY: "change-me-to-a-random-key-at-least-32-chars",
      ...validStorage,
    }, "production")).toHaveLength(2)
  })

  it("accepts independently configured production secrets", () => {
    expect(productionSecurityEnvironmentErrors({
      AUTH_SECRET: "a".repeat(64),
      FILE_SIGNING_KEY: "b".repeat(64),
      ...validStorage,
    }, "production")).toEqual([])
  })
})
