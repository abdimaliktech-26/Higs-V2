# Higsi V2 Production Readiness

Last updated: July 14, 2026

## Launch-readiness baseline

The accepted Production Readiness Audit is the current launch-readiness baseline.

Higsi V2 is approved for development, demonstrations with synthetic data, and internal workflow evaluation. It is **not approved** for customer use with real protected health information (PHI), a controlled PHI pilot, or broad commercial production.

The core product workflow is substantially built. Production hardening now takes priority over feature expansion. Billing, onboarding automation, PDF finalization, object-storage migration, and additional product features remain out of scope until the readiness workstreams authorize them.

Completing PR-1 does not make Higsi V2 PHI-ready.

## PR-1 — Live Staff Authorization Foundation

### Objective

PR-1 establishes a database-backed staff authorization boundary that immediately observes current user existence, membership disablement or removal, role changes, organization access changes, and live Super Admin status. The existing NextAuth JWT session remains in place, but JWT membership, role, and Super Admin claims are non-authoritative for protected server actions.

The shared authorization layer is intentionally split into focused helpers rather than one function with optional arguments:

- `getLiveStaffAuthorizationContext()` identifies the session user and reloads the current database user. The JWT contributes only the stable user ID and an organization-selection hint.
- `requireActiveOrganizationMembership(organizationId, reason)` requires a current `OrganizationMember` row with `status === ACTIVE` and returns its current role.
- `requireOrganizationRole(organizationId, allowedRoles, reason)` applies a live target-organization role allowlist.
- `requireClientAccess(clientId, capability, reason)` derives the owning organization from the client and applies organization-wide or assignment-scoped access.
- `requirePacketAccess(packetId, capability, reason)` derives the organization and client from the packet.
- `requireDocumentAccess(documentId, capability, reason)` derives the organization and client through the document's parent packet.
- `requireActiveAssignableStaff(organizationId, userId)` rejects missing, foreign-organization, invited, or disabled assignees.

Protected resource helpers never authorize from `session.user.activeOrganizationId`. They load the target resource, derive its owning organization, resolve the authenticated user's live membership in that organization, and then apply the live role and assignment policy.

### Approved access policy

- Organization-wide client access: `SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR`.
- Assignment-scoped client access: `CASE_MANAGER`, `DSP`, and `NURSE` only while a current `StaffAssignment` exists for the target client.
- Client creation: `SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR` only. The selected organization is a target selector for this new-resource action and is followed by a live role check.
- Packet creation: `SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR` for any client in the organization; `CASE_MANAGER` only for a currently assigned client. `DSP` and `NURSE` cannot create packets.
- Packet approval submission: the packet-creation role/scope policy applies.
- Approval decisions: `SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR` in the organization owning the packet. A submitter cannot approve, reject, or request changes on their own approval request.
- Staff assignment changes: `SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR` only. The target assignee must have a live active membership in the client's organization.

The intentionally restrictive client-creation policy leaves a possible Case Manager intake-before-assignment workflow as an open exception requiring separate review; no organization-wide Case Manager access was granted implicitly.

### Global Super Admin exception

Global Super Admin authorization is derived from the live `User.isSuperAdmin` database field, not the JWT. A global Super Admin may access a target organization without a normal membership under the existing platform model. Resource helpers require a non-empty operational reason, expose whether the access is cross-tenant, and sensitive converted writes preserve organization-scoped audit events with the live actor ID.

Full break-glass approval, time-limited elevation, authorization-version/session revocation, and customer-visible Super Admin access logs remain deferred governance work. Live database checks prevent stale JWT authorization claims from granting access, but a dedicated mechanism for invalidating the identity session itself remains a future hardening item.

### PR-1 pilot conversions

The approved small, high-risk pilot set now uses the shared live authorization layer:

- client creation;
- staff-to-client assignment;
- packet creation, including active same-organization assignee validation;
- packet detail reads;
- approval submission, decision, and cancellation;
- staff document-editor reads as the representative document action.

Existing business behavior outside authorization remains intact, including packet conditional materialization, pending-signature approval gates, document condition evaluation, audit creation, and portal behavior.

### Verification coverage

Dedicated tests cover missing/deleted identities; stale JWT membership, role, and Super Admin claims; active, invited, disabled, and removed memberships; immediate role changes; multi-organization target resolution; organization-wide and assignment-scoped roles; assigned and unassigned client access; packet and document ownership; packet-creation policy; approval submission and decision policy; self-approval prevention; cancellation; client creation; active/foreign assignees; and explicit global Super Admin access.

Final PR-1 verification:

- 55/55 new authorization and converted-action tests passed across three dedicated suites.
- 681/681 focused authorization, packet/document, staff-signature, portal-authorization, and portal-signing regression tests passed.
- 1,172/1,172 tests passed across 52 files in the full suite.
- ESLint, Prisma format, Prisma validation, TypeScript type-check, and the Next.js production build passed.
- The signature/form suites still print pre-existing, non-failing React `act(...)` advisory annotations; these are tracked separately from PR-1 results.
- PR-1 introduces no Prisma schema or migration change.

### Remaining legacy authorization

PR-1 is a foundation and pilot, not a repository-wide conversion. Server actions outside the pilot still using legacy `requireOrgAccess`, `getActiveRole`, or JWT organization/role claims must be inventoried and migrated in later production-readiness slices. This includes, among others, client list/detail/update/archive and bulk actions, most template administration, packet list/update, document writes and status transitions, validation, signature administration, reports, audit views, settings, notifications, and other staff mutations/reads.

Portal grant/token authorization and portal signing remain separate, purpose-built authorization paths and were not replaced by staff authorization helpers in PR-1. Their regression suites must remain green.

## PR-2A — Live Staff File Authorization

Staff file delivery no longer treats a signed storage key as authorization. New staff file URLs sign only a database resource type and resource ID (`document_template`, `packet_document`, `pdf_version`, or `supporting_document`). On every request, the file route:

- validates the resource-bound signature and expiry;
- loads the current database resource and derives its owning organization;
- resolves packet/document/client parent chains and rejects inconsistent ownership;
- applies current membership, current role, and current client assignment through the PR-1 live authorization helpers;
- resolves the storage key only after authorization succeeds;
- rate-limits by the live database actor;
- closes the file handle after reading;
- returns `private, no-store` and `nosniff` response headers; and
- records an organization-scoped `DOCUMENT_DOWNLOADED` audit event without placing the storage key or PHI in metadata.

Legacy raw-storage-key URLs are rejected. The unused generic upload endpoint is disabled because it created files without an owning database resource; template, supporting-document, and portal uploads continue through their resource-specific workflows. Portal file delivery remains on its separate live portal-grant authorization path.

Before a controlled PHI pilot, all remaining PHI-bearing staff paths must use live authorization, remaining Super Admin governance and session-revocation controls must be resolved, and the other Production Readiness Audit findings must be closed and re-verified.
