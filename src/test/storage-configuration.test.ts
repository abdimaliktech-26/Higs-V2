import { describe, expect, it } from "vitest"
import { productionStorageEnvironmentErrors, readStorageConfiguration } from "@/lib/storage/config"
import { StorageConfigurationError } from "@/lib/storage/errors"

const valid = {
  STORAGE_PROVIDER: "s3",
  AWS_REGION: "us-east-2",
  S3_DURABLE_BUCKET: "higsi-production-durable",
  S3_QUARANTINE_BUCKET: "higsi-production-quarantine",
  S3_KMS_KEY_ARN: "arn:aws:kms:us-east-2:123456789012:key/12345678-1234-1234-1234-123456789012",
  S3_SIGNED_URL_TTL_SECONDS: "60",
}

describe("storage configuration", () => {
  it("accepts production S3 with workload identity and no access keys", () => {
    expect(productionStorageEnvironmentErrors(valid, "production")).toEqual([])
    expect(readStorageConfiguration(valid, "production")).toMatchObject({ provider: "s3", region: "us-east-2", signedUrlTtlSeconds: 60 })
  })

  it.each([undefined, "local", "memory"])("rejects production provider %s", (STORAGE_PROVIDER) => {
    expect(productionStorageEnvironmentErrors({ ...valid, STORAGE_PROVIDER }, "production")).toContain("STORAGE_PROVIDER must be s3 in production")
  })

  it("requires separate durable and quarantine buckets", () => {
    expect(productionStorageEnvironmentErrors({ ...valid, S3_DURABLE_BUCKET: undefined }, "production")).toContain("S3_DURABLE_BUCKET must be a non-placeholder production bucket")
    expect(productionStorageEnvironmentErrors({ ...valid, S3_QUARANTINE_BUCKET: undefined }, "production")).toContain("S3_QUARANTINE_BUCKET must be a non-placeholder production bucket")
    expect(productionStorageEnvironmentErrors({ ...valid, S3_QUARANTINE_BUCKET: valid.S3_DURABLE_BUCKET }, "production")).toContain("S3_DURABLE_BUCKET and S3_QUARANTINE_BUCKET must be different")
  })

  it("requires region and a non-placeholder customer-managed KMS key", () => {
    expect(productionStorageEnvironmentErrors({ ...valid, AWS_REGION: undefined }, "production")).toContain("AWS_REGION is required in production")
    expect(productionStorageEnvironmentErrors({ ...valid, S3_KMS_KEY_ARN: "change-me-kms-key" }, "production")).toContain("S3_KMS_KEY_ARN must identify a non-placeholder customer-managed KMS key")
  })

  it.each([undefined, "0", "61", "1.5", "not-a-number"])("rejects invalid signed URL TTL %s", (S3_SIGNED_URL_TTL_SECONDS) => {
    expect(productionStorageEnvironmentErrors({ ...valid, S3_SIGNED_URL_TTL_SECONDS }, "production")).toContain("S3_SIGNED_URL_TTL_SECONDS must be an integer between 1 and 60")
  })

  it("rejects endpoint overrides in production", () => {
    expect(productionStorageEnvironmentErrors({ ...valid, S3_ENDPOINT: "http://localhost:9000" }, "production")).toContain("S3_ENDPOINT overrides are not allowed in production")
  })

  it("defaults non-production development to local us-east-2 configuration", () => {
    expect(readStorageConfiguration({}, "development")).toMatchObject({ provider: "local", region: "us-east-2", signedUrlTtlSeconds: 60 })
  })

  it("rejects unknown providers in every environment", () => {
    expect(() => readStorageConfiguration({ STORAGE_PROVIDER: "unknown" }, "test")).toThrow(StorageConfigurationError)
  })
})
