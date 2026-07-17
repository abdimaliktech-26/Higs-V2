import "server-only"

import { UserRole } from "@prisma/client"
import { prisma } from "../db"
import {
  ORGANIZATION_WIDE_CLIENT_ROLES,
  getLiveStaffAuthorizationContext,
  requireClientAccess,
  requireOrganizationRole,
  requirePacketAccess,
} from "../live-authorization"

const MANAGER_ROLES: UserRole[] = ["SUPER_ADMIN", "ORG_ADMIN", "COMPLIANCE_DIRECTOR", "CASE_MANAGER"]

export class SupportingUploadAuthorizationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "SupportingUploadAuthorizationError"
  }
}

export interface AuthorizedSupportingUpload {
  userId: string
  organizationId: string
  clientId?: string
  packetId?: string
}

/**
 * The live authorization contract of the legacy supporting-document writer,
 * preserved verbatim: packet-bound uploads require manage access to the
 * packet, client-bound uploads require manage access to the client, unbound
 * uploads require an organization-wide role, and every branch requires a
 * manager role. Run at initiation and re-run at completion.
 */
export async function authorizeStaffSupportingUpload(input: {
  clientId?: string | null
  packetId?: string | null
}): Promise<AuthorizedSupportingUpload> {
  let clientId = input.clientId ?? undefined
  let authorization
  if (input.packetId) {
    authorization = await requirePacketAccess(input.packetId, "manage", "upload supporting document")
    const packet = await prisma.packet.findUnique({
      where: { id: input.packetId },
      select: { clientId: true, organizationId: true },
    })
    if (!packet || packet.organizationId !== authorization.organizationId || (input.clientId && packet.clientId !== input.clientId)) {
      throw new SupportingUploadAuthorizationError("Packet not found")
    }
    clientId = packet.clientId
  } else if (clientId) {
    authorization = await requireClientAccess(clientId, "manage", "upload supporting document")
  } else {
    const identity = await getLiveStaffAuthorizationContext()
    if (!identity.selectedOrganizationId) throw new SupportingUploadAuthorizationError("Select an organization")
    authorization = await requireOrganizationRole(identity.selectedOrganizationId, ORGANIZATION_WIDE_CLIENT_ROLES, "upload unbound supporting document")
  }
  if (!MANAGER_ROLES.includes(authorization.role)) throw new SupportingUploadAuthorizationError("Insufficient permissions")
  return {
    userId: authorization.userId,
    organizationId: authorization.organizationId,
    clientId,
    packetId: input.packetId ?? undefined,
  }
}
