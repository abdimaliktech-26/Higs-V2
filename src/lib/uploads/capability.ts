import { readUploadScannerConfiguration, type UploadScannerEnvironment } from "./config"
import { GuardDutyS3EventDrivenScanner, type MalwareScannerAvailability, type MalwareScannerAvailabilitySource } from "./scanner"
import { productionStorageEnvironmentErrors, type StorageEnvironment } from "../storage/config"

export type UploadCapabilityReason =
  | "SCANNER_DISABLED"
  | "SCANNER_UNAVAILABLE"
  | "SCANNER_NOT_APPROVED"
  | "STORAGE_NOT_PRODUCTION_SAFE"
  | "PLATFORM_LIMITS_UNVERIFIED"

export interface UploadCapability {
  acceptsProductionUploads: boolean
  scannerAvailability: MalwareScannerAvailability
  reasons: UploadCapabilityReason[]
  syntheticDataOnly: boolean
}

export interface UploadCapabilityInput {
  scanner: MalwareScannerAvailabilitySource
  environment?: string
  storageProvider?: string
  platformLimitsVerified?: boolean
  scannerApprovedForProduction?: boolean
}

export interface ConfiguredUploadCapabilityInput {
  environment?: string
  scannerEnvironment?: UploadScannerEnvironment
  storageEnvironment?: StorageEnvironment
}

export async function getUploadCapability(input: UploadCapabilityInput): Promise<UploadCapability> {
  const environment = input.environment ?? process.env.NODE_ENV ?? "development"
  const scannerAvailability = await input.scanner.availability()
  const reasons: UploadCapabilityReason[] = []

  if (scannerAvailability === "disabled") reasons.push("SCANNER_DISABLED")
  if (scannerAvailability === "unavailable") reasons.push("SCANNER_UNAVAILABLE")

  if (environment === "production") {
    if (!input.scannerApprovedForProduction) reasons.push("SCANNER_NOT_APPROVED")
    if ((input.storageProvider ?? process.env.STORAGE_PROVIDER) !== "s3") {
      reasons.push("STORAGE_NOT_PRODUCTION_SAFE")
    }
    if (!input.platformLimitsVerified) reasons.push("PLATFORM_LIMITS_UNVERIFIED")
  }

  return {
    acceptsProductionUploads: environment === "production" && reasons.length === 0,
    scannerAvailability,
    reasons,
    syntheticDataOnly: true,
  }
}

export async function getConfiguredUploadCapability(input: ConfiguredUploadCapabilityInput = {}): Promise<UploadCapability> {
  const environment = input.environment ?? process.env.NODE_ENV ?? "development"
  const scannerEnvironment = input.scannerEnvironment ?? process.env as UploadScannerEnvironment
  const storageEnvironment = input.storageEnvironment ?? process.env as StorageEnvironment
  const configuration = readUploadScannerConfiguration(scannerEnvironment)
  const storageProductionSafe = productionStorageEnvironmentErrors(storageEnvironment, environment).length === 0
    && storageEnvironment.STORAGE_PROVIDER === "s3"
  const scanner = new GuardDutyS3EventDrivenScanner(
    configuration.provider === "guardduty-s3",
    configuration.errors.length === 0,
  )
  return getUploadCapability({
    scanner,
    environment,
    storageProvider: storageProductionSafe ? "s3" : "invalid",
    platformLimitsVerified: configuration.platformLimitsVerified,
    scannerApprovedForProduction: configuration.operationallyApproved,
  })
}
