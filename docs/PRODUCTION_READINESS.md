# Higsi V2 Production Readiness

Last updated: July 14, 2026

## Launch-readiness baseline

The accepted Production Readiness Audit is the current launch-readiness baseline.

Higsi V2 is approved for development, demonstrations with synthetic data, and internal workflow evaluation. It is **not approved** for customer use with real protected health information (PHI), a controlled PHI pilot, or broad commercial production.

The core product workflow is substantially built. Production hardening now takes priority over feature expansion. Billing, onboarding automation, PDF finalization, object-storage migration, and additional product features remain out of scope until the readiness workstreams authorize them.

Completing PR-1 does not make Higsi V2 PHI-ready.

## Current checkpoint decision after PR-1 through PR-4

The authorized in-repository live-authorization and session-hardening work is complete. Staff actions, staff API routes, staff file delivery, direct server-rendered Prisma reads, and platform-wide Super Admin reads now derive authorization from current database state. The final authorization regression baseline is 1,289/1,289 tests across 67 files, with Prisma validation, TypeScript, ESLint, the production build, the real Postgres migration, and the standalone CI seed path verified.

Higsi V2 remains approved only for synthetic-data development/demonstrations and internal workflow evaluation. It is still **not approved** for real PHI or a controlled PHI pilot because the remaining blockers require work that was explicitly deferred or external operational/legal evidence:

- durable encrypted object storage and verified file backup/restore;
- distributed production rate limiting;
- malware scanning for uploads;
- staff MFA and reviewed SSO/session governance;
- real PDF version materialization instead of placeholder version keys;
- reviewed signature/authorization consent language and evidence policy;
- vendor BAAs, deployment architecture, encryption/key-management evidence, monitoring/alerting, incident response, retention/deletion policy, and tested disaster recovery; and
- full break-glass/time-limited Super Admin governance and customer-visible access reporting.

No claim that the SaaS is commercially complete or PHI-ready should be made until those items are separately authorized, implemented or evidenced, and re-audited. Billing and onboarding automation remain product-feature deferrals and are not prerequisites for validating the completed authorization foundation itself.

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

## PR-2M — Server-Rendered Direct-Query Authorization

A final repository-wide Prisma audit found four server-rendered data modules outside the action/API directories covered by PR-2L's legacy scan. They now use the same live boundary:

- the organization dashboard ignores role, user, and Super Admin props for authorization, reloads the current target-organization role, applies effective assignment dates to clients, packets, signatures, and validation aggregates, and self-scopes audit activity for assignment-scoped staff;
- the platform dashboard requires a live global Super Admin check before cross-tenant counts;
- analytics program and client-growth data requires a current client-read role and is assignment-scoped for Case Manager, DSP, and Nurse;
- notification packet focus authorizes the owning packet before loading client/Medicaid context, while upcoming deadlines are assignment-scoped; and
- organization program configuration reads require current active membership.

Five focused tests prove stale page props cannot widen dashboard scope, all dashboard validation periods are scoped, audit activity is self-scoped, platform counts require live Super Admin, analytics/deadlines use effective assignments, notification focus uses packet authorization, and organization configuration uses active membership. This closes the direct server-rendered Prisma gap; page-level redirects remain presentation routing only and are not treated as an authorization boundary.

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

## PR-5A — Storage Abstraction and Object Metadata

PR-5A establishes the adapter-first foundation for production file storage without changing any live upload or download path. AWS S3 is the approved production provider architecture, with environment-configured region (`us-east-2` is the current example), separate durable and quarantine buckets, SSE-KMS with a customer-managed key, and workload identity rather than static application credentials. AWS accounts, buckets, policies, KMS keys, Block Public Access, TLS-only enforcement, backup services, and a BAA are not provisioned or verified by this code step.

The provider-neutral contract supports structured streaming puts/gets, metadata, existence, copy, deletion, and future signed operations. Development uses a filesystem adapter, tests use a deterministic version-aware memory adapter, and production configuration accepts only S3. Native S3 signed methods are implemented as dormant adapter capabilities: no staff or portal call site uses them, signed reads require a version ID, and their TTL is capped at 60 seconds. The approved initial delivery model remains application-authorized, application-proxied streaming for PR-5C.

Central tenant-safe builders accept only opaque CUID/UUID resource identifiers and cover template sources, packet versions, client/organization supporting documents, portal request uploads, quarantine, and reserved future final/signature artifacts. Names, filenames, emails, SSNs, Medicaid IDs, dates of birth, titles, separators, and arbitrary path fragments are not accepted as key inputs.

The additive `StoredObject` model records provider/bucket/key/version, checksum, size, MIME type, encryption reference, lifecycle and scan state, and future-facing immutable/retention/legal-hold fields. Its optional one-to-one links from `DocumentTemplate`, `SupportingDocument`, and `PdfVersion` are nullable and not authoritative in PR-5A. The migration performs no backfill, creates no object rows, preserves every legacy file column, and adds no `PacketDocument` storage relation. `PENDING` and `NOT_SCANNED` are metadata defaults only; they do not represent a malware scan, quarantine promotion, finalization, or retention control.

The existing `src/lib/storage.ts` exports remain a compatibility façade over local storage. Template uploads, template versions, staff supporting uploads, portal uploads, staff delivery, portal delivery, placeholder PDF-version behavior, and signatures are not cut over. The 14 generic synthetic seed PDFs now live under `prisma/fixtures/templates`; runtime `private/data`, local quarantine, backups, and migration working outputs are ignored by Git.

Higsi remains a PHI no-go after PR-5A. Real PHI requires an executed AWS BAA, approved production/staging accounts and regions, provisioned private buckets and KMS controls, and completion of the remaining production-readiness work. The preliminary RPO of 15 minutes and RTO of four hours are planning targets only, not tested guarantees.

Deferred boundaries:

- PR-5B: staged upload migration using the PR-5B.1 lifecycle foundation described below;
- PR-5C: migrate staff and portal reads to live-authorized, application-proxied object streaming;
- PR-5D: existing-file migration, object/database backup provisioning, restore automation, rehearsal, and evidence; and
- PR-5E: immutable finalized artifacts, Object Lock, legal hold, and retention enforcement after finalization and legal policy approval.

## PR-5B.1 — Upload Lifecycle and Validation Foundation

PR-5B.1 adds only the control-plane foundation for a future quarantine-first upload migration. No active template, template-version, staff-supporting, or portal upload route uses it yet; no read route changed; the local compatibility façade remains authoritative for current behavior. Higsi remains a PHI no-go and production uploads must not be described as available or malware-safe.

`UploadAttempt` is separate from `StoredObject`. It records an opaque attempt identity, intended owner, exactly one staff-or-portal actor, SHA-256 hash of a required client UUID idempotency token, quarantine metadata, planned durable key, bounded failure/cleanup state, and stage timestamps. The raw token, filename, names, titles, email, SSN, IP address, credentials, and provider errors are not stored. The database idempotency boundary is `(organizationId, actorType, actorIdentityId, uploadKind, idempotencyKeyHash)`, avoiding nullable-actor uniqueness gaps while retaining nullable staff and portal foreign keys. Completed keys return the completed result, active keys remain in-progress/conflict, failed keys remain terminal, and intentional retry requires a new UUID. There is no cross-tenant or checksum-based deduplication.

The legal progression is `INITIATED → RECEIVING → QUARANTINED → VALIDATING → VALIDATED → SCANNING → PROMOTING → PROMOTED → LINKING → LINKED_CLEANUP_PENDING/COMPLETED`; any non-terminal stage can become `FAILED` with bounded stage/category evidence. `FAILED` and `COMPLETED` cannot return to an active state. Promotion requires a real `CLEAN` scanner result. A durable `StoredObject` row is created only after the promoted object checksum, size, provider, and encryption metadata match; it starts `PENDING` and cannot become `AVAILABLE` until a later owner-link transaction succeeds with strict audit evidence. PR-5B.1 creates no production owner links or object rows.

Receipt primitives stream once into a mode-`0600` ephemeral spool under a mode-`0700` directory, enforce actual bytes, compare declared and actual size, and calculate SHA-256 during that same pass. The spool supplies the precomputed length/checksum required by the current S3 adapter and is deleted deterministically after success or failure. Parser work operates only on this already bounded spool. All three profiles use a typed 25 MB limit: templates accept strict PDF only; staff supporting and the portal profile accept PDF, JPEG, PNG, and DOCX. PR-5B.3 decided HEIC: it is rejected because deep server-side structural validation is the standard every accepted format must meet and no approved HEIC decoder exists in the runtime; support is deferred to a recorded backlog item with decoder, resource-limit, malformed-file, and production-runtime prerequisites.

Deep validation returns bounded categories rather than parser messages. PDF validation rejects encrypted, malformed, zero-page, embedded-file, JavaScript, launch-action, executable-attachment, XFA, and other prohibited active content. JPEG/PNG validation decodes structure with dimension, pixel, frame, and malformed/truncation limits without transforming the image. DOCX validation bounds ZIP entries and compressed/decompressed size and ratio, rejects traversal, macros, executable payloads, and external relationships, and requires `[Content_Types].xml`, `_rels/.rels`, and `word/document.xml`. `sharp@0.34.5` is a direct runtime image-validation dependency; `fflate@0.8.2` is the small runtime ZIP parser. `pdfjs-dist`, already present, supplies PDF structural parsing.

The scanner boundary contains a disabled implementation and deterministic clean/infected/error test implementations only. Disabled or unavailable scanners never report `CLEAN`. Application startup is not blocked when a scanner is absent because no endpoint is migrated, but the typed production capability result remains unavailable without an available scanner, production-safe S3 selection, and verified host body-size, duration, proxy/load-balancer, and streaming limits. No vendor, network call, or malware-clean claim exists.

Future final linkage must use the narrow strict transaction-aware audit helpers, which propagate database failures and roll back the owning transaction; existing best-effort audit behavior is unchanged. Read-only reconciliation reports bounded opaque findings for stale attempts/quarantine, stuck promotion, durable objects without metadata, pending/available unowned metadata, unavailable or missing provider objects, cleanup-pending and owner-link inconsistencies, and legacy `PdfVersion` placeholders. It performs no write, repair, scheduling, or deletion. Provisional expiry planning is 24 hours for ordinary abandoned/failed quarantine and seven days for infected or suspected-malicious objects; no retention or cleanup job enforces those values.

One direct successor per `DocumentTemplate.previousVersionId` is now database-enforced, with the additive migration refusing to proceed if populated data contains a conflict. No version row is rewritten. Future migrated writers may create opaque compatibility copies and dual-write verified legacy metadata through PR-5C; PR-5B.1 creates no copy and adds no façade-level S3 read bridge.

Remaining PR-5B boundaries:

- PR-5B.2A: the GuardDuty event/control-plane foundation described below;
- PR-5B.2B: migrate template and template-version writers through the approved asynchronous and compatibility boundary; all reads remain deferred to PR-5C;
- PR-5B.3 (complete): the HEIC rejection decision plus the staff-supporting and portal-request writer migration described below; and
- PR-5B.4 (complete): reconciliation operationalized with storage probes, bounded cleanup/recovery execution approved and implemented, migration leftovers removed, and synthetic upload-platform verification tooling added; only the dedicated-runtime execution of that tooling remains an external operational step before PR-5C read cutover.

PR-5B.1 does not provision S3, malware scanning, cleanup jobs, backups, restore automation, final PDFs, Object Lock, or retention enforcement. It does not change signatures, billing, MFA, notifications, or product features. AWS BAA and infrastructure controls remain required, and the unverified RPO/RTO targets remain 15 minutes/four hours.

## PR-5B.2A — GuardDuty Upload Scan Control Plane

PR-5B.2A adds the approved event-driven malware-scan control plane without migrating an active upload or read path. AWS GuardDuty Malware Protection for S3 is the selected production scanner architecture for the quarantine bucket. This selection remains subject to an executed AWS BAA, confirmation of the covered production services, approved accounts/regions, provisioned private S3/KMS/IAM controls, and an end-to-end operational test. It does not make Higsi PHI-ready.

GuardDuty scan results are asynchronous. The approved infrastructure path is GuardDuty → EventBridge → SQS with a dead-letter queue → an idempotent worker. The repository now exposes the worker processing boundary but does not provision EventBridge, SQS, a DLQ, GuardDuty plans, IAM roles, KMS policies, alarms, or a worker runtime. The worker caller must delete an SQS message only after processing succeeds; lifecycle races are retryable, while malformed, untrusted, and conflicting events must be dead-lettered without logging the raw event or object location.

Only the exact configured AWS account, region, Malware Protection plan ARN, quarantine bucket, and supported GuardDuty event type are accepted. Results are matched to one `UploadAttempt` by provider, bucket, opaque object key, and required S3 version ID; ETag mismatches fail closed. `NO_THREATS_FOUND` is the only result mapped to `CLEAN`. `THREATS_FOUND` maps to `INFECTED`; `UNSUPPORTED`, `ACCESS_DENIED`, and `FAILED` map to bounded scan failure. Status/result pairs are validated, duplicate EventBridge event IDs are acknowledged idempotently, and a different second result conflicts. Threat names, status reasons, raw AWS payloads, bucket/key data, and provider errors are not persisted as scanner evidence.

Migration `20260715180000_add_guardduty_scan_control_plane` is additive. It adds `UploadScannerProvider`, nullable scanner provider/reference/request/result timestamps, a unique scanner-event identity, and a unique populated quarantine-object identity. PostgreSQL still permits multiple all-null pre-lifecycle tuples. The migration performs no backfill and changes no `StoredObject`, owner, legacy storage, or active file row.

Production scanner capability remains fail-closed unless the GuardDuty configuration is internally consistent, `MALWARE_SCANNER_OPERATIONALLY_APPROVED=true` records a completed operational review, the storage provider is S3, and `UPLOAD_PLATFORM_LIMITS_VERIFIED=true` records successful 25 MB body/streaming/duration/cancellation/proxy/load tests. These flags are evidence gates, not infrastructure provisioning or compliance guarantees. Scanner configuration does not block application startup because no active writer uses it in PR-5B.2A.

The staff status route returns only bounded lifecycle state to the original staff uploader after live identity and current target-organization authorization are rechecked. Responses are private/no-store. It never returns organization IDs, buckets, object keys, versions, ETags, checksums, idempotency hashes, or scanner references. Portal status remains deferred with portal-writer migration.

The current Vercel function path cannot receive the approved 25 MB application-proxied upload because Vercel documents a 4.5 MB function request-body limit. The approved production direction is a dedicated long-running upload runtime, preferably AWS ECS/Fargate in the same approved account and region. Its network, workload identity, BAA, request limits, streaming, cancellation, timeout, concurrency, and load behavior remain operational prerequisites. Direct browser-to-S3 upload remains unapproved.

Remaining boundaries:

- PR-5B.2B: implement the asynchronous initiate/stream/status UI protocol and migrate template writers through quarantine, deep validation, GuardDuty results, promotion, strict linkage/audit, and temporary compatibility metadata without changing any reader;
- PR-5B.3 (complete): HEIC rejected for migrated writers; staff-supporting and portal-request writers migrated with live authorization preserved;
- PR-5B.4 (complete): cleanup/reconciliation operations and upload-platform verification tooling implemented; runtime execution evidence remains operational; and
- PR-5C: 5C.1 dual-source readers and 5C.2 legacy backfill complete; 5C.3 compatibility retirement deferred behind the evidence gate below.

PR-5B.2A adds no active scanner network call, public scanner webhook, SQS poller, automatic cleanup, compatibility copy, native S3 URL, backup, restore, finalization, Object Lock, retention, signature, billing, MFA, notification, or product-feature behavior. Higsi remains a PHI no-go.

## PR-5B.2B — Template Upload Migration

PR-5B.2B migrates only the new-template and template-version writers. After live staff authorization and the upload-runtime evidence gate pass, each route requires a client-generated UUID idempotency key, streams the PDF through the bounded 25 MB spool, writes the SHA-256-bound object to the quarantine bucket, performs the strict PDF validation profile, and records `SCANNING` with GuardDuty S3 as the event-driven scanner. The receipt returns only the opaque attempt ID and bounded status. It does not create a `DocumentTemplate`, `StoredObject`, compatibility file, or audit row before a scan result.

GuardDuty remains asynchronous. The existing original-uploader-only status route is polled by the template UI. Only a version-bound GuardDuty `CLEAN` result permits the authenticated completion endpoint to copy the exact quarantine version to the deterministic durable S3 key. Durable checksum, size, MIME type, provider version, and SSE-KMS key evidence are re-read and verified before a `StoredObject` is created as `PENDING`. A single database transaction then creates the `DocumentTemplate`, links the object, changes it to `AVAILABLE`, writes mandatory strict audit evidence, and advances the attempt to cleanup-pending. Audit or linkage failure rolls back that transaction. The exact quarantine version is deleted afterward; deletion failure leaves bounded cleanup-pending state for reconciliation and does not undo the already committed owner.

The additive `TemplateUploadIntent` model carries only the template metadata needed across the asynchronous wait. It is one-to-one with `UploadAttempt`, preallocates the future template ID, and optionally records the prior version ID. Original filenames, storage locations, raw idempotency keys, provider errors, and PHI are not stored there. `UploadAttempt` remains the control-plane record and `StoredObject` remains durable object identity. Migration `20260716120000_migrate_template_uploads` creates only this intent table and indexes; it performs no backfill or existing-row update.

Template-version completion reloads the previous version inside the final transaction, creates version `previous.version + 1`, and preserves field geometry plus field-owned nested condition cloning. The existing unique constraint on `DocumentTemplate.previousVersionId` is the database concurrency control: only one direct successor can commit. Existing packet/template mappings are not repointed.

Readers are deliberately unchanged. Each successful migrated writer creates a temporary opaque local compatibility copy and continues to populate verified legacy `fileKey`, `fileUrl`, `fileSize`, and `mimeType` metadata so current authorized staff delivery keeps working until PR-5C. `StoredObject` is authoritative only for the two migrated writer paths; no current reader follows it, no native S3 URL is exposed, and no browser uploads directly to S3. The compatibility copy remains single-instance and is not a production/PHI-safe read architecture.

The migrated routes fail closed before multipart parsing when S3/GuardDuty configuration, scanner operational approval, or the 25 MB platform verification flag is absent. Application startup may still succeed, but template uploads return unavailable. The operational gates—GuardDuty protection, EventBridge/SQS/DLQ, least-privilege IAM/KMS, deployed worker, alarms, real synthetic end-to-end evidence, dedicated upload runtime, and AWS BAA/service coverage—remain external prerequisites and are not provisioned here.

Staff supporting and portal writers remain on their previous behavior and are deferred. No staff/portal reader, delivery route, scanner vendor integration, SQS poller, cleanup job, backup, restore, final PDF, Object Lock, retention enforcement, signature, notification, billing, MFA, or product feature is added. Higsi remains synthetic-data-only and a PHI no-go.

## PR-5B.3 — Supporting and Portal Upload Migration

PR-5B.3 migrates the two remaining legacy writers onto the PR-5B.2B pipeline and changes no reader.

The staff supporting writer moves from a whole-file-buffering server action with no content validation to a dedicated receipt route. Binding targets (client or packet) travel as query parameters so the exact legacy authorization contract — packet-manage, client-manage, or organization-wide role, each behind the manager-role gate — runs live before any multipart byte is parsed; the shared helper that implements it is re-run at completion, so an assignment or role revoked during the asynchronous scan blocks linkage. The route adds the staff rate limiter, the UUID idempotency key, and the staff supporting validation profile. The legacy `uploadSupportingDocument` server action is removed so no unscanned staff supporting write path remains.

The portal writer keeps its receipt-time controls exactly: portal session identity, `canUploadDocuments` from the request record, request-derived organization/client, uploadable-status precheck, and per-user-and-IP rate limiting. Receipt now stops at `SCANNING`. The portal completion transaction re-reads the request row as the source of truth and preserves the legacy workflow atomically: the race-safe conditional `PENDING`/`NEEDS_REPLACEMENT` to `SUBMITTED` transition, the `SupportingDocument` created with `PENDING_REVIEW` and the sanitized display filename, the `UPLOADED`/`RESUBMITTED` timeline event, the strict portal audit evidence, and the portal notification (a transactional database row, so rollback removes it atomically). A request cancelled or completed during scanning yields a bounded conflict with no document, event, or notification. New portal-authenticated status and completion routes are uploader-scoped, re-check `canUploadDocuments` live, and expose only opaque lifecycle state.

The additive `SupportingUploadIntent` model carries staff-entered document metadata (staff rows) or the request pointer plus sanitized display filename (portal rows) across the asynchronous boundary, one-to-one with `UploadAttempt`, with the owner ID preallocated. The additive `validated_mime_type` column records the deep-validation-detected MIME type at the `VALIDATED` transition; completion requires it, uses it for the durable copy, and re-verifies it against the promoted object alongside checksum, size, version, and SSE-KMS evidence. Migration `20260716200000_migrate_supporting_uploads` is additive only.

HEIC is rejected in PR-5B.3. The legacy portal route accepted HEIC with only a shallow `ftyp` check — below the deep-validation standard the pipeline establishes — and the runtime ships no HEIC decoder (prebuilt sharp/libvips excludes HEIF). The portal accept list and validation profile both reject it with a clear supported-format message. HEIC support is a backlog item requiring an approved decoder strategy, bounded resource limits, malformed-file testing, and production-runtime verification.

Readers remain deliberately unchanged. Successful writers populate verified legacy `fileKey`/`fileUrl`/`fileSize`/`mimeType` metadata and an opaque local compatibility copy so current staff and portal delivery keeps working until PR-5C. `StoredObject` is authoritative only for the four migrated writer paths. Reconciliation, cleanup execution, read migration, browser-direct uploads, native signed URLs, backup, restore, retention, billing, MFA, notifications beyond the preserved portal row, and product features remain deferred. Higsi remains synthetic-data-only and a PHI no-go.

## PR-5B.4 — Reconciliation, Cleanup, and Platform Verification

PR-5B.4 operationalizes the dormant PR-5B.1 reconciliation foundation without touching any reader or introducing any PR-5C behavior.

Recovery (`recoverStuckUploadAttempts`) fails abandoned and crash-stuck attempts — stale INITIATED/RECEIVING/PROMOTING/PROMOTED/LINKING by inactivity, and expired QUARANTINED/VALIDATING/VALIDATED/SCANNING by their recorded expiry — exclusively through the guarded lifecycle transitions. A live completion racing recovery always wins; the loser records a bounded CONFLICT outcome. A GuardDuty result arriving after a scan timeout hits the same guarded update and conflicts instead of reviving the attempt. Recovery never touches storage.

Cleanup (`executeQuarantineCleanup`) deletes only the exact quarantine object version recorded on an eligible attempt: LINKED_CLEANUP_PENDING immediately (the durable owner already exists), FAILED only after its recorded retention expiry — 24 hours ordinary, seven days infected/suspect, stamped at failure time. Attempts with a recorded key but no recorded version are skipped for review rather than guessed at. Durable objects are never deleted; durable orphan findings stay report-only. Provider failures record nothing so the attempt stays PENDING for rerun; completion and conflict are recorded through guarded transitions; every run is batch-bounded, idempotent, and returns an auditable attempted/recovered/cleaned/skipped/conflicted/failed summary.

Storage-backed probes wire the reconciliation report to the S3 adapter read-only. A probe error or unprobeable location (foreign bucket, non-S3 provider) is reported as a probe failure and treated as \"exists\", so transient provider trouble can never generate a missing-object finding or motivate destructive follow-up.

Operator surface: `npm run upload:reconcile` (read-only report), `npm run upload:cleanup` (recovery + cleanup with `--dry-run`, batch, and staleness bounds), and `npm run upload:verify-platform` (synthetic 25 MB spool→quarantine→durable→read-back→exact-delete round trips plus an optional HTTP receipt probe). The cleanup and platform tools fail closed unless `STORAGE_PROVIDER=s3`; the platform tool never sets `UPLOAD_PLATFORM_LIMITS_VERIFIED` — the operator records that evidence manually for the runtime that actually passed. A read-only, global-super-admin-only `GET /api/admin/upload-reconciliation` route exposes the database-only findings; no destructive operation is reachable from application traffic. Scripts execute under `--conditions=react-server` (the official `server-only` package was added as a devDependency) so the client-bundle guard remains fully active.

Migration leftovers removed: the superseded buffer-based template validator (`document-template-upload.ts`) and the legacy portal buffer validator (only `sanitizeFileName` remains). No schema change, no migration, and no reader change are part of PR-5B.4. Remaining before PR-5C: executing the platform verification on the provisioned dedicated upload runtime and recording its evidence — an operational step outside this repository.

## PR-5C.1/5C.2 — Dual-Source Reads and Legacy Backfill

PR-5C.1 makes `StoredObject` authoritative for reads of linked rows. The staff file route and the portal file route resolve any row with a `storedObjectId` to the exact recorded durable S3 object version and stream it through the application (no full-object buffering, no native S3 URL, quarantine never read). Qualification requires provider S3, lifecycle AVAILABLE, malware status CLEAN or NOT_SCANNED, a recorded object version, a matching organization, and the configured durable bucket. PENDING, INFECTED, and ERROR objects never serve. NOT_SCANNED is accepted deliberately and only for backfilled legacy bytes: those files were already being served unscanned from local disk, so the durable source never weakens the existing posture, and everything newly uploaded still requires a real GuardDuty CLEAN. A linked row never falls back to the local copy — disqualifying metadata is a bounded non-serve and provider trouble is a bounded 503. Rows without `storedObjectId` serve exactly as before from local storage, and placeholder-only `pdf_version` rows are excluded until final PDF generation exists. Authorization contracts, signed-link schemes, rate limits, portal visibility and access-level rules, and the staff download audit are unchanged; content type and length for durable reads come from verified StoredObject metadata rather than filename inference.

PR-5C.2 adds the operator-only backfill (`npm run upload:backfill`): batch-bounded, additive, idempotent, resumable, S3-gated, and unreachable from application traffic. Each unlinked template/supporting row's existing local file is streamed through the bounded spool, magic-sniffed, written to the durable bucket, and verified (checksum, size, MIME, SSE-KMS key, exact version) before a single guarded transaction creates the AVAILABLE StoredObject with honest `NOT_SCANNED` status and links the owner. A concurrent link, verification mismatch, missing local file, or unsupported format produces a bounded auditable outcome with no database change; a failed link leaves only a report-only durable orphan. The local file is never replaced or deleted, so rollback remains a deployment decision.

The reconciliation report gains `OWNER_NOT_DURABLY_RESOLVABLE`: owner rows with a legacy file that do not yet resolve to a servable durable object. Driving this finding to zero — together with staging evidence from the dual-source readers and the platform-verification tooling — is the measurable gate for PR-5C.3 compatibility retirement, which remains deferred and requires its own approval. Durable-orphan deletion also stays deferred until that evidence exists, because until every owner provably resolves to its exact durable version, an unreferenced durable object cannot be distinguished from the only verified copy of a record.

## Generated Completed-PDF Durable Storage

Completed PDFs use the trusted server-generated-object path: bytes are produced server-side from the pristine, previously validated template plus database field values, so they do not transit quarantine or GuardDuty. Their StoredObject is recorded `AVAILABLE` with the honest `malwareStatus: NOT_SCANNED` (generated internally, never scanned as an external upload) and must never be represented as CLEAN. Delivery stays application-proxied through the signed, authorized streaming routes; the exact recorded S3 object version is always read, never a latest-key lookup.

Environment behavior is explicit and fail-closed. Development/test without S3 keeps local-compatibility-only generation exactly as before (`storedObjectId` null). In any S3-configured environment the durable verified write (SSE-KMS, no-overwrite precondition, checksum/size/MIME/KMS/exact-version verification) is mandatory: a failed or unverified durable write creates no PdfVersion and never silently downgrades to local-only storage. The authoritative StoredObject and PdfVersion rows, the `currentVersion` bump, and a strict audit write commit in one transaction — audit failure rolls back everything, a transaction failure leaves at most an unowned durable artifact (report-only per PR-5B.4), and the `(packetDocumentId, version)` unique constraint bounds concurrent generation.

Compatibility policy: the temporary local copy is written after the durable write succeeds, solely for PR-5C.3 interim compatibility. Because linked rows are served from the StoredObject and never the local copy, a compatibility-copy failure does not invalidate the durable business record — the row is created with the intended compatibility path recorded, and only the durable source serves it. Staff `pdf_version` delivery and the portal latest-version read now pass the linked `storedObjectId` through the PR-5C.1 dual-source reader; legacy and placeholder rows keep their existing local behavior unchanged. Reconciliation distinguishes true placeholders (`LEGACY_PLACEHOLDER`, no stored bytes) from real generated versions not yet durably resolvable (`GENERATED_VERSION_NOT_DURABLE`), making the generated-document gap measurable alongside the PR-5C.3 owner gate.

### Unresolved dependency-security advisories at PR-5A closeout

`npm audit` reports five moderate package-level findings from two underlying advisories. All five affected versions were already present in the pre-PR-5A lockfile; neither `@aws-sdk/client-s3` nor `@aws-sdk/s3-request-presigner` introduced an advisory. No broad dependency override, downgrade, or major-version change is included in PR-5A.

- `next@16.2.10` is a direct runtime dependency reported through its exact `postcss@8.4.31` dependency. The current stable Next.js release is still 16.2.10, so no supported non-breaking parent-package update is available. npm's proposed `next@9.3.3` resolution is a breaking downgrade and is not acceptable.
- `postcss@8.4.31` is transitive through Next.js and is affected by GHSA-qx2v-qp2m-jg93 (unescaped `</style>` during CSS stringify). PostCSS has a patched 8.x release (`>=8.5.10`), but Next.js pins 8.4.31 exactly. The vulnerable functionality is part of the production dependency graph but Higsi does not stringify user-supplied CSS at runtime; it remains tracked until Next.js publishes a supported update.
- `prisma@7.8.0` is a direct development dependency reported through `@prisma/dev`. The current stable Prisma release remains 7.8.0. npm proposes `prisma@6.19.3`, which is a breaking downgrade rather than a compatible patch.
- `@prisma/dev@0.24.3` is transitive development tooling and inherits the `@hono/node-server` finding. No non-breaking Prisma parent-package release currently resolves the pinned dependency.
- `@hono/node-server@1.19.11` is transitive development tooling through `@prisma/dev` and is affected by GHSA-92pp-h63x-v22m (repeated-slash `serveStatic` middleware bypass). A patched 1.x release exists (`>=1.19.13`), but `@prisma/dev@0.24.3` pins 1.19.11 exactly. Higsi does not use this package as its production application server.

These findings remain production-readiness dependency-security work. Reassess supported Next.js and Prisma releases before a controlled PHI pilot; do not treat the current audit result as PHI-ready.

PR-5B.1 adds direct runtime declarations for `fflate@0.8.2` and `sharp@0.34.5` (`sharp` was already present transitively through Next.js). The install audit remains five moderate findings; neither declaration added a new reported advisory. The existing five findings above remain unresolved and require a fresh registry-backed audit during closeout verification.
