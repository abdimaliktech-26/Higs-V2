import "server-only"

import { StorageConfigurationError } from "./errors"
import { readStorageConfiguration, type StorageConfiguration } from "./config"
import { LocalStorageAdapter } from "./local-adapter"
import { MemoryStorageAdapter } from "./memory-adapter"
import { S3StorageAdapter } from "./s3-adapter"
import type { StorageAdapter } from "./types"

export * from "./types"
export * from "./errors"
export * from "./keys"
export * from "./config"
export { LocalStorageAdapter } from "./local-adapter"
export { MemoryStorageAdapter } from "./memory-adapter"
export { S3StorageAdapter, mapS3Error } from "./s3-adapter"

export function createStorageAdapter(configuration: StorageConfiguration = readStorageConfiguration()): StorageAdapter {
  switch (configuration.provider) {
    case "local":
      return new LocalStorageAdapter({ root: configuration.localRoot })
    case "memory":
      return new MemoryStorageAdapter()
    case "s3":
      if (!configuration.region || !configuration.durableBucket || !configuration.quarantineBucket || !configuration.kmsKeyArn) {
        throw new StorageConfigurationError("S3 storage configuration is incomplete")
      }
      return new S3StorageAdapter({
        region: configuration.region,
        durableBucket: configuration.durableBucket,
        quarantineBucket: configuration.quarantineBucket,
        kmsKeyArn: configuration.kmsKeyArn,
        endpoint: configuration.endpoint,
      })
  }
}
