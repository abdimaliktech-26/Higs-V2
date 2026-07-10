import { redirect } from "next/navigation"
import { requirePortalAuth, PortalAuthError } from "@/lib/portal/auth"
import { getPortalAuthorizedClients } from "@/lib/actions/portal-dashboard"
import { resolvePortalClientId } from "@/lib/portal/client-selection"

/**
 * Shared entry point for every authenticated portal page. Redirects to
 * /portal/login on any auth failure, then resolves which client to display
 * from the `client` query param — falling back to the user's first
 * authorized client rather than trusting an invalid/foreign id. The actual
 * data reads on each page still independently call
 * requirePortalClientAccess/Permission; this only decides which client the
 * page *asks* for.
 */
export async function resolvePortalPageContext(requestedClientId: string | undefined) {
  try {
    await requirePortalAuth()
  } catch (error) {
    if (error instanceof PortalAuthError) redirect("/portal/login")
    throw error
  }

  const clients = await getPortalAuthorizedClients()
  const currentClientId = resolvePortalClientId(requestedClientId, clients)
  return { clients, currentClientId }
}
