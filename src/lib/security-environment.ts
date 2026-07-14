const PLACEHOLDER_MARKERS = ["change-me", "your-secret", "your-key", "example"]

function validSecret(value: string | undefined): boolean {
  if (!value || value.length < 32) return false
  const normalized = value.toLowerCase()
  return !PLACEHOLDER_MARKERS.some((marker) => normalized.includes(marker))
}

export function productionSecurityEnvironmentErrors(
  env: { AUTH_SECRET?: string; FILE_SIGNING_KEY?: string },
  nodeEnv: string | undefined,
): string[] {
  if (nodeEnv !== "production") return []
  const errors: string[] = []
  if (!validSecret(env.AUTH_SECRET)) errors.push("AUTH_SECRET must be a non-placeholder value of at least 32 characters")
  if (!validSecret(env.FILE_SIGNING_KEY)) errors.push("FILE_SIGNING_KEY must be a non-placeholder value of at least 32 characters")
  return errors
}

export function assertProductionSecurityEnvironment(): void {
  const errors = productionSecurityEnvironmentErrors({
    AUTH_SECRET: process.env.AUTH_SECRET,
    FILE_SIGNING_KEY: process.env.FILE_SIGNING_KEY,
  }, process.env.NODE_ENV)
  if (errors.length > 0) throw new Error(`Unsafe production security configuration: ${errors.join("; ")}`)
}
