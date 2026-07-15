import type { MalwareScanner, MalwareScannerAvailability } from "./scanner"

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
  scanner: MalwareScanner
  environment?: string
  storageProvider?: string
  platformLimitsVerified?: boolean
  scannerApprovedForProduction?: boolean
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
