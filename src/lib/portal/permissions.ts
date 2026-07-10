/**
 * Stage 2 does not build a legal-authority/consent capture workflow
 * (PortalAccessAuthorization creation), so sign/upload/guardian-management
 * permissions can never be granted through invitation acceptance yet —
 * regardless of what a staff member requests. These three are hardcoded
 * false here, not sourced from input, so there is no code path that could
 * accidentally trust a client-supplied value for them.
 */
export interface PortalGrantPermissions {
  canViewDocuments: boolean
  canUploadDocuments: boolean
  canSignDocuments: boolean
  canViewAppointments: boolean
  canMessageCareTeam: boolean
  canManageOtherGuardians: boolean
}

export interface RequestablePortalPermissions {
  canViewDocuments?: boolean
  canViewAppointments?: boolean
  canMessageCareTeam?: boolean
}

/** Used when staff create an invitation — only view-oriented flags are requestable. */
export function sanitizeRequestedPermissions(input: unknown): RequestablePortalPermissions {
  const raw = (input ?? {}) as Record<string, unknown>
  return {
    canViewDocuments: raw.canViewDocuments === true,
    canViewAppointments: raw.canViewAppointments === true,
    canMessageCareTeam: raw.canMessageCareTeam === true,
  }
}

/** Used when an invitation is accepted — derives the actual grant from what was requested. */
export function deriveGrantPermissions(requested: unknown): PortalGrantPermissions {
  const safe = sanitizeRequestedPermissions(requested)
  return {
    canViewDocuments: safe.canViewDocuments ?? false,
    canViewAppointments: safe.canViewAppointments ?? false,
    canMessageCareTeam: safe.canMessageCareTeam ?? false,
    canUploadDocuments: false,
    canSignDocuments: false,
    canManageOtherGuardians: false,
  }
}
