import { StorageConfigurationError } from "./errors"
import type { StorageProvider } from "./types"

const PLACEHOLDER_MARKERS = ["change-me", "your-", "example", "placeholder"]

export interface StorageEnvironment {
  STORAGE_PROVIDER?: string
  STORAGE_LOCAL_ROOT?: string
  AWS_REGION?: string
  S3_DURABLE_BUCKET?: string
  S3_QUARANTINE_BUCKET?: string
  S3_KMS_KEY_ARN?: string
  S3_ENDPOINT?: string
  S3_SIGNED_URL_TTL_SECONDS?: string
}

export interface StorageConfiguration {
  provider: StorageProvider
  localRoot: string
  region?: string
  durableBucket?: string
  quarantineBucket?: string
  kmsKeyArn?: string
  endpoint?: string
  signedUrlTtlSeconds: number
}

function present(value: string | undefined): boolean {
  if (!value?.trim()) return false
  const normalized = value.toLowerCase()
  return !PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
}

export function productionStorageEnvironmentErrors(env: StorageEnvironment, nodeEnv: string | undefined): string[] {
  if (nodeEnv !== "production") return []
  const errors: string[] = []
  if (env.STORAGE_PROVIDER !== "s3") errors.push("STORAGE_PROVIDER must be s3 in production")
  if (!present(env.AWS_REGION)) errors.push("AWS_REGION is required in production")
  if (!present(env.S3_DURABLE_BUCKET)) errors.push("S3_DURABLE_BUCKET must be a non-placeholder production bucket")
  if (!present(env.S3_QUARANTINE_BUCKET)) errors.push("S3_QUARANTINE_BUCKET must be a non-placeholder production bucket")
  if (env.S3_DURABLE_BUCKET && env.S3_QUARANTINE_BUCKET && env.S3_DURABLE_BUCKET === env.S3_QUARANTINE_BUCKET) {
    errors.push("S3_DURABLE_BUCKET and S3_QUARANTINE_BUCKET must be different")
  }
  if (!present(env.S3_KMS_KEY_ARN) || !env.S3_KMS_KEY_ARN?.startsWith("arn:aws:kms:")) {
    errors.push("S3_KMS_KEY_ARN must identify a non-placeholder customer-managed KMS key")
  }
  const ttl = Number(env.S3_SIGNED_URL_TTL_SECONDS)
  if (!env.S3_SIGNED_URL_TTL_SECONDS || !Number.isInteger(ttl) || ttl < 1 || ttl > 60) {
    errors.push("S3_SIGNED_URL_TTL_SECONDS must be an integer between 1 and 60")
  }
  if (env.S3_ENDPOINT) errors.push("S3_ENDPOINT overrides are not allowed in production")
  return errors
}

export function readStorageConfiguration(
  env: StorageEnvironment = process.env as StorageEnvironment,
  nodeEnv: string | undefined = process.env.NODE_ENV,
): StorageConfiguration {
  const errors = productionStorageEnvironmentErrors(env, nodeEnv)
  if (errors.length > 0) throw new StorageConfigurationError(errors.join("; "))
  const provider = (env.STORAGE_PROVIDER ?? (nodeEnv === "test" ? "memory" : "local")) as StorageProvider
  if (!(["local", "memory", "s3"] as string[]).includes(provider)) throw new StorageConfigurationError("STORAGE_PROVIDER is invalid")
  const ttl = env.S3_SIGNED_URL_TTL_SECONDS ? Number(env.S3_SIGNED_URL_TTL_SECONDS) : 60
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > 60) throw new StorageConfigurationError("Signed storage URL TTL must be between 1 and 60 seconds")
  return {
    provider,
    // The local adapter resolves this configured path only when selected.
    // Keeping production configuration free of process-wide path resolution
    // also prevents Next.js from tracing the entire repository into a route.
    localRoot: env.STORAGE_LOCAL_ROOT ?? "./private/data",
    region: env.AWS_REGION ?? (nodeEnv === "production" ? undefined : "us-east-2"),
    durableBucket: env.S3_DURABLE_BUCKET,
    quarantineBucket: env.S3_QUARANTINE_BUCKET,
    kmsKeyArn: env.S3_KMS_KEY_ARN,
    endpoint: env.S3_ENDPOINT,
    signedUrlTtlSeconds: ttl,
  }
}
