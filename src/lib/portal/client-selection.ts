interface AuthorizedClient {
  clientId: string
}

/**
 * The `client` query param is only ever a hint for which authorized client
 * to display — it is never trusted on its own. Every page independently
 * re-verifies the resolved id via requirePortalClientAccess/Permission
 * before reading any data for it, so an unauthorized id here just falls
 * back to the user's first authorized client instead of granting access.
 */
export function resolvePortalClientId(requested: string | undefined, authorized: AuthorizedClient[]): string | null {
  if (authorized.length === 0) return null
  if (requested && authorized.some((c) => c.clientId === requested)) return requested
  return authorized[0].clientId
}
