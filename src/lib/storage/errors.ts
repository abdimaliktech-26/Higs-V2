export type StorageErrorCode =
  | "CONFIGURATION"
  | "INVALID_KEY"
  | "PATH_TRAVERSAL"
  | "NOT_FOUND"
  | "INTEGRITY"
  | "CONFLICT"
  | "PROVIDER_AUTHORIZATION"
  | "THROTTLED"
  | "TRANSIENT_PROVIDER"
  | "UNSUPPORTED"

export interface StorageErrorDiagnostics {
  providerRequestId?: string
}

export class StorageError extends Error {
  constructor(
    public readonly code: StorageErrorCode,
    safeMessage: string,
    public readonly diagnostics: StorageErrorDiagnostics = {},
    options?: ErrorOptions,
  ) {
    super(safeMessage, options)
    this.name = new.target.name
  }
}

export class StorageConfigurationError extends StorageError {
  constructor(message = "Storage is not configured safely") { super("CONFIGURATION", message) }
}

export class InvalidStorageKeyError extends StorageError {
  constructor(message = "The storage key is invalid") { super("INVALID_KEY", message) }
}

export class StoragePathTraversalError extends StorageError {
  constructor() { super("PATH_TRAVERSAL", "The storage key is unsafe") }
}

export class StorageNotFoundError extends StorageError {
  constructor(diagnostics?: StorageErrorDiagnostics) { super("NOT_FOUND", "The stored object was not found", diagnostics) }
}

export class StorageIntegrityError extends StorageError {
  constructor(message = "Stored object integrity verification failed") { super("INTEGRITY", message) }
}

export class StorageConflictError extends StorageError {
  constructor(message = "The storage operation conflicted with the current object state", diagnostics?: StorageErrorDiagnostics) {
    super("CONFLICT", message, diagnostics)
  }
}

export class StorageProviderAuthorizationError extends StorageError {
  constructor(diagnostics?: StorageErrorDiagnostics) {
    super("PROVIDER_AUTHORIZATION", "The storage provider rejected the operation", diagnostics)
  }
}

export class StorageThrottledError extends StorageError {
  constructor(diagnostics?: StorageErrorDiagnostics) { super("THROTTLED", "The storage provider throttled the operation", diagnostics) }
}

export class StorageTransientProviderError extends StorageError {
  constructor(diagnostics?: StorageErrorDiagnostics, options?: ErrorOptions) {
    super("TRANSIENT_PROVIDER", "The storage provider could not complete the operation", diagnostics, options)
  }
}

export class StorageUnsupportedOperationError extends StorageError {
  constructor(message = "This storage operation is not supported") { super("UNSUPPORTED", message) }
}
