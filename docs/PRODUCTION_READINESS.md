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

Full break-glass approval, time-limited elevation, and customer-visible Super Admin access logs remain deferred governance work. Versioned staff-session revocation and live Super Admin claim refresh were completed in PR-3.

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

## PR-2B — Client, Packet, and Document Action Conversion

The next PHI-bearing staff paths now use PR-1 live authorization:

- client lists are resolved against live target-organization roles and assignment-scoped roles are always filtered to the live actor's current client assignments;
- client detail, update, archive, program lookup, and assignable-staff lookup no longer authorize from JWT membership/role snapshots;
- assigned Case Managers may update assigned clients, while archival remains organization-wide-role-only;
- packet lists apply the same live organization/assignment scope;
- ordinary packet workflow changes require live packet manage access, packet archival requires an organization-wide role, and arbitrary status strings are rejected;
- the generic packet-status action can no longer set `approved`, so approval cannot bypass the separate audited approval-request decision and separation-of-duties check;
- packet-document status changes use live document write access and reject unknown statuses;
- document field save/evaluation/add/update, version creation, comments, and portal-visibility sharing use live document access and the live actor ID; and
- direct field/version mutations now reject conditionally inactive documents and approved/archived packet locks instead of relying on the editor UI.

Assignment-scoped DSP and Nurse roles remain read-only for client/packet/document resources. Case Managers receive manage access only for currently assigned clients. Client creation, client archival, assignment administration, packet archival, and approval decisions retain their more restrictive organization-wide policies.

## PR-2C — Approval Reads and Staff Signature Administration

Approval and staff-signature administration now use the same live target-resource boundary:

- approval lists require a current approval-workflow role; Case Manager results are limited to packets for currently assigned clients, while organization-wide roles retain organization-wide results;
- approval detail loads only the minimal target identity first, then authorizes against the owning packet before loading names, Medicaid identifiers, documents, validation results, or events;
- eligible signature fields are authorized through the owning packet, and eligible portal-signing grants through the owning client;
- signature-request creation derives the actor, organization, role, and assignment scope from the live packet authorization result rather than JWT organization or role claims;
- signature status transitions and staff signature execution require live access to the request's owning packet, preserve the staff-self-signature identity check, and record the live database actor;
- staff signature lists require a current signature-management role and limit Case Managers to currently assigned clients; and
- staff signature detail authorizes the owning packet before loading signer, client, document, field, or event details.

`SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR` retain organization-wide approval/signature administration. `CASE_MANAGER` is assignment-scoped. `DSP` and `NURSE` cannot administer approval or signature workflows. Portal signature discovery and execution remain on the separate live portal session, grant, permission, and accepted-authorization checks; PR-2C does not weaken or replace them.

## PR-2D — Reports and Audit Read Boundaries

Report and audit surfaces now derive access from current database membership and role:

- report access requires a current client-read role;
- Case Manager, DSP, and Nurse report aggregates are restricted to currently assigned clients across clients, packets, documents, validation results, signatures, approvals, and supporting documents;
- assignment-scoped staff activity reports expose only the live actor's own audit activity;
- organization-wide roles retain organization-wide report aggregates;
- audit event lists ignore caller-supplied actor filters for non-administrative roles, preventing a user from overriding the enforced self scope;
- audit detail authorizes the event's organization and actor scope before loading actor or organization detail;
- assignment-scoped audit dashboard packet metrics include only currently assigned clients; and
- resource audit summaries first derive the owning organization from a minimal event lookup, then return only that organization's events and enforce self scope for non-administrative roles.

These changes also make assignment start and end dates authoritative in reporting and audit packet aggregates, rather than treating any historical assignment row as current access.

## PR-2E — Validation Workflow Authorization

Compliance validation now uses live target-organization and target-packet authorization throughout:

- validation-rule reads require current active organization membership;
- rule creation treats the selected organization only as a new-resource target, then requires a current organization-wide management role;
- rule status changes derive the organization from the rule and record the live actor;
- packet validation authorizes the owning packet and current client assignment before loading the detailed packet/client/document field model or running condition-aware validation;
- validation result lists require a current validation role and limit Case Managers to currently assigned clients;
- result detail loads a minimal result target first, authorizes its owning packet, then loads client Medicaid identifiers, documents, issues, and staff detail; and
- issue resolution authorizes the owning packet before the detailed issue read and records the live database actor as resolver and audit actor.

The existing condition-aware validation engine, rule scoping, scoring, packet status transitions, and audit behavior remain intact. DSP and Nurse roles cannot run or administer validation; assigned Case Managers can run validation and work with results only for their assigned clients.

## PR-2F — Portal Invitation and Signing-Authorization Administration

Staff-side portal access administration now uses current database roles in the organization that owns the target resource:

- invitation creation derives the organization from the selected client rather than the staff session's selected organization;
- invitation revocation derives the organization from the invitation;
- portal access-grant revocation derives the organization from the grant;
- invitation, access-grant, and client-picker reads require a current organization-wide portal-management role;
- signing-authorization creation, listing, revocation, and sign-permission changes derive the organization from the access grant or client; and
- every converted write records the live database actor instead of a JWT role or actor snapshot.

Portal management remains restricted to `SUPER_ADMIN`, `ORG_ADMIN`, and `COMPLIANCE_DIRECTOR`. The public invitation activation flow and portal-user consent acceptance continue to use their separate token, portal-session, live-grant, and concurrency controls and were not replaced by staff authorization.

## PR-2G — Portal Document-Request Administration

Staff-side portal document-request workflows now derive authorization from the target client, request, or access grant:

- request creation derives the organization and assignment scope from the client, then validates optional packet/document links against that same client and organization;
- cancellation, review start, approval, and replacement decisions derive access from the request's client and reject inconsistent request/client organization chains;
- organization-level request lists restrict assigned Case Managers to current assignments, while direct client lists require live manage access to that client;
- portal upload-permission changes derive the organization from the access grant and remain restricted to organization-wide management roles;
- staff checklist summaries require live client read access; and
- request, timeline, feedback, packet-document completion, notification, and audit writes use the live database actor.

The portal user's checklist, upload history, feedback, and request reads remain protected by the separate live portal-client grant boundary. Existing duplicate-request, review-state, upload-provenance, packet-completion, notification, and audit behavior remains intact.

## PR-2H — Organization User and Settings Administration

Organization user administration now enforces current database-backed management roles:

- organization user lists require a live `SUPER_ADMIN` or `ORG_ADMIN` role in the requested organization;
- user creation treats the session's selected organization only as a new-resource target, then performs a live role check before creating either the user or membership;
- user role, status, name, and department changes derive authorization from the target membership's organization;
- role and other membership/user changes record the live actor, with status/name/department changes now producing an explicit `USER_UPDATED` audit event; and
- organization settings reads require current active membership, while settings writes require the live management role in the selected target organization.

This makes membership disablement and role changes effective on the next protected action through the shared live authorization layer; no JWT membership or role snapshot is trusted for these administration operations.

## PR-2I — Staff Notification Privacy Boundary

Staff notifications are now private to their live database owner:

- list, total, and unread queries always include both the target organization and the live actor's user ID;
- read and dismiss mutations derive the organization from the notification and reject a notification owned by another user, even if that user shares the organization;
- notification generation uses the current target-organization role and live actor;
- Case Manager, DSP, and Nurse source queries are limited to currently assigned clients;
- signature-administration notifications are generated only for signature-management roles, and validation/approval notifications remain organization-wide-role-only; and
- duplicate detection includes the recipient user ID so another user's existing alert cannot suppress the current user's alert.

This closes the prior organization-wide notification read and mutation exposure and prevents generated PHI-bearing messages from including unassigned clients.

## PR-2J — AI Workflow Authorization

AI extraction, analysis, recommendation, and history actions now use live resource authorization:

- document extraction authorizes the owning packet document and client assignment before loading fields, then records the live actor;
- packet analysis authorizes the owning packet before loading documents, validation results, or signatures;
- recommendation application derives access from the linked document or packet, falling back to a live organization role only for legacy unlinked recommendations;
- Case Manager extraction and recommendation lists are restricted to currently assigned clients across both packet-linked and document-linked records; and
- audit metadata for applied recommendations no longer copies the recommendation message, avoiding unnecessary PHI or generated narrative in audit metadata.

AI use remains restricted to organization-wide roles and assigned Case Managers. DSP and Nurse roles cannot run or administer these AI workflows.

## PR-2K — Document Library Authorization

The staff document library now applies live authorization before returning or mutating PHI-bearing resources:

- library lists and dashboard aggregates require a current client-read role;
- Case Manager, DSP, and Nurse packet-document and supporting-document results are restricted to currently assigned clients, including active assignment dates;
- packet list filters compose organization, status, client, and assignment predicates without allowing one predicate to overwrite the organization boundary;
- packet-document detail authorizes the owning document and packet before loading client, field, or template detail;
- supporting-document detail derives authorization from its packet or client and rejects inconsistent organization chains before loading detail;
- template detail requires current active membership in the template's owning organization;
- packet- and client-bound supporting-document uploads derive the organization and live actor from the owning resource; and
- unbound supporting-document uploads are restricted to organization-wide roles in the selected target organization.

The conversion preserves the existing library tabs, searches, categories, signed file delivery, audit events, and storage behavior. Six focused tests cover assignment-filter composition, organization-wide scope, client-bound and unbound uploads, authorization-before-detail loading, and organization-chain mismatch rejection. Final verification passed 1,270/1,270 tests across 63 files, ESLint, Prisma format and validation, TypeScript type-check, and the Next.js production build. No schema or migration change was introduced.

## PR-2L — Template Administration Authorization

Document- and packet-template administration now uses the live database-backed staff boundary throughout:

- document-template lists, detail, field layouts, condition trees, dependency summaries, validators, packet-template lists, and template activity require current active membership in the target organization;
- new template uploads treat the selected organization only as a target, then require the current organization-wide template-management role;
- new-version uploads, template status changes, field create/update/delete, condition-group and condition mutations, and packet-template mapping changes derive the target organization from the existing resource before applying the current role;
- packet-template creation uses the selected organization only after reloading the live staff identity and current role;
- upload rate limits and audit records use the live database actor rather than JWT role, membership, or Super Admin snapshots;
- global Super Admin access remains explicit through the shared live authorization helper and its operation-specific reason; and
- assignment-scoped packet lists now require a currently effective assignment, including start and end dates, instead of accepting any historical assignment row.

The conversion preserves PDF validation/storage, immutable template version rows, field and condition carry-forward behavior, condition validation and cycle detection, dependency protection, packet materialization, and existing audit behavior. The five focused template suites passed 198/198 tests and the full suite passed 1,270/1,270 tests across 63 files. No legacy `requireOrgAccess`, `getActiveRole`, JWT membership, or JWT selected-role authorization remains under `src/lib/actions` or `src/app/api`; the remaining `isGlobalSuperAdmin` use is the explicit live value returned by the shared authorization layer. No schema or migration change was introduced.

## PR-3 — Versioned Staff Session Revocation and Live Super Admin Governance

The existing Auth.js JWT strategy is retained, but every staff-session access now revalidates the identity and session version against Postgres:

- deleted users immediately lose the session;
- a `User.sessionVersion` mismatch clears the JWT cookie, providing deterministic all-session revocation without storing raw session tokens;
- live `isSuperAdmin` and active-membership claims replace their JWT snapshots on every access;
- invited and disabled memberships are omitted from refreshed session claims;
- a non-Super-Admin with no active memberships loses the staff session;
- a selected organization that is no longer active moves to the first remaining active membership, while resource authorization continues to derive ownership from the target resource;
- role and membership-status changes increment the affected user's session version; and
- `revokeOrgUserSessions` provides an explicit, live-role-protected, audited all-session revocation action.

Platform-wide Super Admin data reads no longer trust `session.user.isSuperAdmin`. Each read uses `requireGlobalSuperAdmin` with an explicit operational reason and reloads the current database flag before any cross-tenant query. Full break-glass approval, time-limited elevation, and customer-visible Super Admin access logs remain separate pre-commercial governance work; PR-3 does not claim those controls exist.

Migration `20260714210000_add_staff_session_version` was applied successfully to the real local Postgres database and migration status is current. Ten new tests cover token refresh, deleted identities, version mismatch, sign-in version adoption, no-active-membership revocation, stale organization selection, version increments, explicit audited revocation, explicit platform-read reasons, and live Super Admin demotion. Focused authorization/session tests passed 63/63; the full suite passed 1,280/1,280 tests across 65 files.

## PR-4 — Security Configuration and Compliance-Claim Integrity

Production security configuration now fails closed when either `AUTH_SECRET` or `FILE_SIGNING_KEY` is missing, shorter than 32 characters, or still contains a documented placeholder marker. Development and tests may retain the existing ephemeral file-signing fallback, but a production process can no longer silently start with a random signing key that invalidates URLs across restarts or instances. Four focused tests cover non-production behavior, missing values, short/placeholders, and valid independent secrets.

Unsupported HIPAA-readiness claims were removed from the public staff login, portal login/invitation/activation/shell, client profile, organization settings, security-center, and existing billing presentation. Copy now describes secure access, protected information, or configured compliance controls without claiming that the accepted PHI no-go baseline has been superseded. This is truth-in-posture hardening only: no billing, MFA, SSO, storage, or compliance-certification feature was started.

PR-4 does **not** make local filesystem storage, in-memory rate limits, database/file backups, malware scanning, MFA, legal consent text, deployment/vendor BAAs, incident response, or disaster recovery production-ready. Those remain explicit controlled-PHI blockers or external operational controls.

Before a controlled PHI pilot, the remaining Production Readiness Audit findings and deferred Super Admin governance controls must be closed and re-verified.
