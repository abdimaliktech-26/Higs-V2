# Higsi V2 — Production Deployment Runbook

> Version 1.1 — updated 2026-07-08  
> Target platform: Vercel (frontend) + Railway / Render / Fly.io (backend)  
> Database: PostgreSQL 16  
> File storage target: AWS S3 — PR-5A adapter/metadata foundation implemented; live call-site cutover deferred

---

## Known Gaps at Launch (read before provisioning)

These are current-state facts about the codebase, not aspirational architecture. Provision infra to match what's actually wired, not what's documented as "target."

- **Live object storage remains local filesystem in PR-5A.** A typed AWS S3 adapter, fail-closed production configuration, tenant-safe keys, and additive `StoredObject` metadata now exist, but existing writers/readers intentionally remain on the `src/lib/storage.ts` compatibility façade until PR-5B/PR-5C. Do not deploy multiple/ephemeral instances or use real PHI yet.
- **Rate limiting is in-memory only.** `src/lib/rate-limit.ts` does not read `REDIS_URL`/Upstash env vars yet — the Redis migration in [Section 6](#6-redis-setup-for-rate-limiting) is documented but not coded. Same multi-instance caveat as above: limits are per-instance, not global.
- **The `auth` rate limiter is defined but never invoked.** `checkRateLimit(limiters.auth, ...)` has no call site in `src/lib/auth.ts` or anywhere else — login currently has no brute-force throttling. The limiter also keys on `userId`, which doesn't exist pre-authentication, so it needs to be re-keyed on email or IP before it can protect the login route (see Section 6 table note).
- **`scripts/backup.sh` only backs up the database.** It does not archive `private/data/` (the local file storage root). Until storage moves to S3, add the manual `tar` step in [Section 4](#4-backup-and-restore-process) to any backup automation, or uploaded PDFs are not covered by RPO.
- **Client SSN is stored in plaintext** (`prisma/schema.prisma`, `Client.ssn`). No field-level encryption or tokenization. Flag for security/compliance sign-off before handling real client PII.

---

## Table of Contents

1. [Staging Setup](#1-staging-setup)
2. [Production Environment Variables](#2-production-environment-variables)
3. [Database Migration Process](#3-database-migration-process)
4. [Backup and Restore Process](#4-backup-and-restore-process)
5. [Sentry Setup](#5-sentry-setup)
6. [Redis Setup for Rate Limiting](#6-redis-setup-for-rate-limiting)
7. [Object Storage Setup for PDFs](#7-object-storage-setup-for-pdfs)
8. [Health Check Monitoring](#8-health-check-monitoring)
9. [Rollback Process](#9-rollback-process)
10. [Beta Launch Checklist](#10-beta-launch-checklist)

---

## 1. Staging Setup

A staging environment must mirror production as closely as possible.

### Infrastructure

```
┌─────────────────────────────────────────────────────────────┐
│                         Vercel                              │
│  higsi-staging.vercel.app  ←  higsi-pr-*.vercel.app        │
│  (production build,    )     (preview deployments per PR)  │
│  staging branch only   )                                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
┌───────────────────────▼─────────────────────────────────────┐
│                    Railway / Render                          │
│  PostgreSQL 16 (512MB RAM, 1GB storage)                     │
│  Redis 7 (optional for rate limiting testing)                │
│  Dedicated staging AWS S3 quarantine and durable buckets    │
└─────────────────────────────────────────────────────────────┘
```

### Setup Steps

```bash
# 1. Create staging branch
git checkout -b staging
git push origin staging

# 2. Connect Vercel to the staging branch
#    - Vercel dashboard → Import Project → Select repo → staging branch
#    - Set root directory: ./
#    - Build command: npm run build
#    - Output directory: .next

# 3. Provision staging database (Railway CLI example)
railway login
railway init
railway add postgres
railway add redis

# 4. Set environment variables in Vercel dashboard
#    (see Section 2 below; use staging values, not production)

# 5. Deploy
vercel --prod
```

### Staging Checklist

- [ ] Staging connects to staging database (never production)
- [ ] Staging uses separate S3 bucket
- [ ] Staging Sentry DSN points to staging project
- [ ] Rate limiting uses relaxed limits (or disabled)
- [ ] Preview deployments work per PR
- [ ] Staging can be seeded with sanitized production data

---

## 2. Production Environment Variables

### Required

| Variable | Example | Source |
|---|---|---|
| `DATABASE_URL` | `postgresql://user:pass@host:6543/db?schema=public&pgbouncer=true&connection_limit=5` | Railway / Render |
| `AUTH_SECRET` | `openssl rand -hex 32` output | Generate at deploy time |
| `FILE_SIGNING_KEY` | `openssl rand -hex 32` output | Generate at deploy time |
| `STORAGE_PROVIDER` | `s3` | Required in production; local/memory rejected |
| `AWS_REGION` | `us-east-2` | Environment-configurable; final region needs approval |
| `S3_DURABLE_BUCKET` | `higsi-production-durable` | Private environment-specific durable bucket |
| `S3_QUARANTINE_BUCKET` | `higsi-production-quarantine` | Must differ from durable bucket |
| `S3_KMS_KEY_ARN` | customer-managed KMS key ARN | Required; provisioned outside the app |
| `S3_SIGNED_URL_TTL_SECONDS` | `60` | Integer 1–60; native delivery remains unused |
| `AUTH_URL` | `https://app.higsi.com` | Your production domain |

### Optional but Recommended

| Variable | Example | Purpose |
|---|---|---|
| `NEXT_PUBLIC_SENTRY_DSN` | `https://key@oXXX.ingest.sentry.io/project` | Client-side error tracking |
| `SENTRY_DSN` | same as above | Server-side error tracking |
| `REDIS_URL` | `rediss://default:pass@host:6379` | Production rate limiting |
| `DB_LOG_QUERIES` | `false` | Slow query logging |
| `NODE_ENV` | `production` | Set automatically by Vercel |

### .env.production Template

```bash
# ── Database (PgBouncer transaction mode recommended) ──
DATABASE_URL="postgresql://user:pass@host:6543/higsi_db?schema=public&pgbouncer=true&connection_limit=5"

# ── Auth ──
AUTH_SECRET="<generate: openssl rand -hex 32>"
AUTH_URL="https://app.higsi.com"

# ── File Storage Signing ──
FILE_SIGNING_KEY="<generate: openssl rand -hex 32>"

# ── Error Tracking ──
NEXT_PUBLIC_SENTRY_DSN="https://key@oXXX.ingest.sentry.io/project"
SENTRY_DSN="${NEXT_PUBLIC_SENTRY_DSN}"

# ── Redis (rate limiting) ──
REDIS_URL="rediss://default:pass@host:6379"

# ── Object Storage (AWS S3; workload identity, no static keys) ──
STORAGE_PROVIDER="s3"
AWS_REGION="us-east-2"
S3_DURABLE_BUCKET="higsi-production-durable"
S3_QUARANTINE_BUCKET="higsi-production-quarantine"
S3_KMS_KEY_ARN="arn:aws:kms:us-east-2:<account-id>:key/<key-id>"
S3_SIGNED_URL_TTL_SECONDS="60"

# ── Feature Flags ──
DB_LOG_QUERIES="false"
```

### Security Rules

- Never commit `.env` files (already in `.gitignore`)
- Generate fresh `AUTH_SECRET` and `FILE_SIGNING_KEY` per environment
- Rotate keys every 90 days
- Use IAM roles instead of access keys where possible
- Restrict database user to only the application database

---

## 3. Database Migration Process

### Principles

- **Never** run `prisma db push` in production (it's destructive)
- **Always** use `prisma migrate deploy` (safe, versioned)
- Migrations run **before** the new app version starts serving traffic
- If a migration fails, **do not** deploy the new app version

### CI/CD Pipeline

```yaml
# In .github/workflows/deploy.yml (example)

deploy:
  steps:
    - name: Run database migrations
      run: npx prisma migrate deploy
      env:
        DATABASE_URL: ${{ secrets.DATABASE_URL }}

    - name: Deploy to Vercel
      run: vercel --prod
```

### Manual Migration

```bash
# 1. Connect to production via SSH or run locally with production DATABASE_URL
npx prisma migrate deploy

# 2. Verify migration status
npx prisma migrate status

# 3. If successful, proceed with deployment
```

### Creating a New Migration (Development)

```bash
# 1. Edit prisma/schema.prisma
# 2. Create migration
npm run migrate:dev -- --name <description>

# 3. Review the generated SQL
cat prisma/migrations/<timestamp>_<name>/migration.sql

# 4. Commit the migration file to version control
git add prisma/migrations/
git commit -m "Add migration: <description>"
```

### Migration Safety Checks

- [ ] Migration does not drop columns with existing data
- [ ] Migration does not rename columns without `@@map` (use `@map` instead)
- [ ] New columns have defaults or are nullable
- [ ] Large table migrations are tested on staging first
- [ ] Migration is reversible (have a rollback plan)

---

## 4. Backup and Restore Process

### Automated Backup

```bash
# Server: Add to crontab (runs daily at 2 AM)
0 2 * * * cd /app && ./scripts/backup.sh /backups 2>&1 | logger -t higsi-backup

# Verification: Check last backup timestamp
ls -lt /backups/*.dump | head -3
```

### Manual Backup

```bash
# Database
pg_dump --format=custom \
  --host=<host> \
  --port=6543 \
  --username=<user> \
  --dbname=higsi_db \
  --file=higsi_backup_$(date +%Y%m%d).dump

# File storage (S3 — once Section 7 migration is done)
aws s3 sync s3://higsi-production/ backups/files/$(date +%Y%m%d)/

# File storage (current: local filesystem — do this until S3 migration lands)
tar -czf "backups/files_$(date +%Y%m%d).tar.gz" -C private data
```

### Restore

```bash
# Database restore (replaces entire database)
pg_restore --dbname=higsi_db \
  --format=custom \
  --clean \
  --if-exists \
  higsi_backup_20240701.dump

# File storage restore
aws s3 sync backups/files/20240701/ s3://higsi-production/

# File storage restore (local filesystem)
tar -xzf backups/files_20240701.tar.gz -C private/data/
```

### Recovery Time Objectives

| Scenario | RTO | RPO |
|---|---|---|
| Database corruption | 30 min | 24 hours |
| File storage loss | 2 hours | 24 hours |
| Full region outage | 4 hours | 24 hours |

---

## 5. Sentry Setup

### Step 1: Create Sentry Project

1. Go to [sentry.io](https://sentry.io) → Create Project → Next.js
2. Copy the DSN: `https://key@oXXX.ingest.sentry.io/project`

### Step 2: Environment Variables

```bash
NEXT_PUBLIC_SENTRY_DSN="https://key@oXXX.ingest.sentry.io/project"
SENTRY_DSN="https://key@oXXX.ingest.sentry.io/project"
```

### Step 3: Verify

The Sentry configuration is already in place:
- `sentry.client.config.ts` — Browser errors, PII stripped
- `sentry.server.config.ts` — Server errors, PII stripped  
- `sentry.edge.config.ts` — Edge/proxy errors
- `src/app/error.tsx` — Captures client errors, falls back gracefully

### Production Configuration

In production, set `tracesSampleRate` to `0.1` (10% of transactions).
The current config already does this:
```ts
tracesSampleRate: process.env.NODE_ENV === "production" ? 0.1 : 0
```

### PII Protection

The Sentry `beforeSend` callback strips email addresses from error messages:
```ts
beforeSend(event) {
  event.exception?.values?.forEach((v) => {
    v.value = v.value?.replace(/[\w.-]+@[\w.-]+\.\w+/g, "[email]")
  })
  return event
}
```

### Alerting

Configure Sentry alerts for:
- **Errors**: Any unhandled exception → notify #alerts Slack channel
- **Crash rate**: >1% crash rate → page on-call
- **Performance**: P95 response time > 5s → investigate

---

## 6. Redis Setup for Rate Limiting

### Why Redis

The in-memory rate limiter works for single-instance deployments.
For multi-instance or serverless (Vercel), **Redis is required** for accurate rate limiting.

### Provisioning

```bash
# Railway
railway add redis

# Upstash (serverless)
# Go to https://upstash.com → Create Redis database → Copy REST URL

# Render
# Dashboard → New Redis → $7/month plan
```

### Environment Variables

```bash
# Upstash (REST-based, recommended for serverless)
UPSTASH_REDIS_REST_URL="https://us1-adequate-lion-12345.upstash.io"
UPSTASH_REDIS_REST_TOKEN="your-token"

# Standard Redis
REDIS_URL="rediss://default:password@host:6379"
```

### Migration from In-Memory

The rate limiter in `src/lib/rate-limit.ts` is designed for easy migration:

```typescript
// Current (in-memory — default):
export const limiters = {
  upload: createMemoryLimiter({ windowMs: 60000, max: 10, name: "upload" }),
  // ...
}

// Production (Redis — swap when REDIS_URL is set):
import { Ratelimit } from "@upstash/ratelimit"
import { Redis } from "@upstash/redis"

const redis = new Redis({ url: process.env.UPSTASH_REDIS_REST_URL!, token: process.env.UPSTASH_REDIS_REST_TOKEN! })

export const limiters = {
  upload: new Ratelimit({ redis, limiter: Ratelimit.slidingWindow(10, "60 s"), prefix: "upload" }),
  // ...
}
```

### Rate Limit Tuning

| Limiter | Window | Limit | Notes |
|---|---|---|---|
| `upload` | 1 min | 10 | File uploads are expensive |
| `fileAccess` | 1 min | 100 | PDF serving, moderate |

| `ai` | 1 min | 10 | AI extraction is CPU-intensive |
| `validation` | 1 min | 20 | Validation runs per user |
| `signature` | 1 min | 30 | Signature actions |
| `auth` | 1 min | 5 | Login attempts — **defined but not wired to the login route yet; also keyed on userId, needs re-keying on email/IP before it's usable pre-auth.** Do not check this off as "working" without verifying it actually fires a 429 on repeated failed logins. |
| `general` | 1 min | 60 | Reserved |

---

## 7. Object Storage Setup for PDFs

### Current live behavior: Local compatibility façade

Existing readers, staff-supporting writers, and portal writers still use `./private/data/` through `src/lib/storage.ts`. PR-5B.2B template/template-version writers now use S3 quarantine and durable storage but also create an opaque local compatibility copy for these unchanged readers. That copy remains single-instance-only and is intentional only until PR-5C.

### PR-5A foundation and AWS S3 target

`src/lib/storage/` now contains the structured contract, safe errors and keys, local/memory adapters, and the AWS S3 adapter. Production validation requires separate durable/quarantine buckets and SSE-KMS configuration and relies on the AWS SDK workload-identity credential chain. It does not accept static access-key variables as application requirements.

### PR-5B.1 upload foundation (not active)

`src/lib/uploads/` contains the additive upload-attempt lifecycle, 25 MB typed profiles, permission-restricted streaming spool/checksum primitive, strict PDF/JPEG/PNG/DOCX validators, scanner interface, strict transaction-aware audit boundary, capability check, and read-only reconciliation report. These modules are not called by an active upload or download route. Existing writers and readers still use `src/lib/storage.ts`; no `StoredObject` relation is authoritative yet.

Production upload capability is deliberately unavailable unless all of the following are proven at runtime/operations review:

- S3 is the production storage provider and the PR-5A fail-closed configuration is valid;
- a separately approved scanner reports available (the current disabled scanner never reports clean); and
- the selected host, reverse proxy/load balancer, and runtime are verified for 25 MB request bodies, streaming behavior, execution duration, and cancellation.

Receipt is designed to stream to a mode-`0600` temporary spool, calculate SHA-256 and actual size in the same pass, then feed quarantine storage with a known checksum and length. Temporary directories are mode `0700` and are removed after both success and failure. This is a foundation only: no active endpoint accepts bytes through it and no automatic quarantine deletion runs.

Planning defaults are 24 hours for ordinary failed/abandoned quarantine and seven days for infected or suspected-malicious quarantine. They are not approved legal retention rules and are not enforced. PR-5B.3 decided HEIC: it is rejected for every migrated writer because no accepted format may skip deep server-side structural validation, and the runtime has no approved HEIC decoder. HEIC support is a recorded backlog item requiring an approved decoder, resource limits, malformed-file testing, and production-runtime verification before reconsideration.

The additive `UploadAttempt` migration stores opaque lifecycle and idempotency evidence separately from durable `StoredObject`. Durable metadata is created only after promotion verification and remains `PENDING`; a later owner-link transaction with mandatory strict audit is required before `AVAILABLE`. Legacy `fileKey`, `fileUrl`, size, and MIME metadata remain in place through PR-5C. Future compatibility copies must use opaque keys and are not created in PR-5B.1.

PR-5B.2A is the GuardDuty event/control-plane foundation below; PR-5B.2B migrated the asynchronous template/template-version writers; PR-5B.3 migrated the staff-supporting and portal-request writers and recorded the HEIC rejection. PR-5B.4 remains approved cleanup/reconciliation operations and hosting/load verification. PR-5C completes every read cutover. Do not enable production PHI uploads based on these application foundations.

### PR-5B.2A GuardDuty control plane (not active)

The selected scanner architecture is GuardDuty Malware Protection for S3 on the quarantine bucket, with version-bound results delivered through EventBridge and SQS. The repository contains the bounded/idempotent message-processing boundary and an original-uploader-only status endpoint; it does not contain or provision the GuardDuty plan, EventBridge rule, SQS queue/DLQ, IAM/KMS policies, alarms, or worker process. Do not expose the worker boundary as an unauthenticated HTTP webhook.

Additional configuration for the future upload runtime is:

```bash
MALWARE_SCANNER_PROVIDER="guardduty-s3"
GUARDDUTY_EXPECTED_AWS_ACCOUNT_ID="<12-digit-approved-account>"
GUARDDUTY_EXPECTED_REGION="us-east-2"
GUARDDUTY_MALWARE_PROTECTION_PLAN_ARN="arn:aws:guardduty:us-east-2:<account>:malware-protection-plan/<opaque-id>"
GUARDDUTY_SCAN_QUEUE_URL="https://sqs.us-east-2.amazonaws.com/<account>/<queue-name>"
MALWARE_SCANNER_OPERATIONALLY_APPROVED="false"
UPLOAD_PLATFORM_LIMITS_VERIFIED="false"
```

Leave both evidence flags false until the scanner path and dedicated upload host have passed their operational tests. Missing scanner configuration does not block ordinary application startup in PR-5B.2A because no active writer is migrated. It does keep production upload capability unavailable.

Vercel Functions have a documented 4.5 MB request-body limit and cannot host Higsi's approved 25 MB application-proxied upload path. Provision and validate a dedicated long-running upload runtime—preferably ECS/Fargate in the approved AWS account/region—before PR-5B.2B. Direct browser-to-S3 uploads remain out of scope. See the Vercel body-limit guidance at https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions and the GuardDuty event schema at https://docs.aws.amazon.com/guardduty/latest/ug/monitor-with-eventbridge-s3-malware-protection.html.

PR-5B.2A itself does not activate template uploads, template-version uploads, scanner calls, SQS polling, compatibility copies, or S3 reads. PR-5B.2B adds the asynchronous template-writer protocol described below; it does not change a read path. Higsi remains a PHI no-go.

### PR-5B.2B/PR-5B.3 migrated writers (active only when all gates pass)

The new-template and template-version routes now require live admin authorization plus a UUID `Idempotency-Key`. Before parsing multipart bytes they require valid S3 configuration, a complete GuardDuty S3 configuration, `MALWARE_SCANNER_OPERATIONALLY_APPROVED=true`, and `UPLOAD_PLATFORM_LIMITS_VERIFIED=true`. If any gate is absent, the application may start but these routes return unavailable without accepting the multipart body.

Receipt streams to the quarantine bucket, verifies actual size and SHA-256, performs deep PDF validation, and stops at `SCANNING`. The browser polls the private original-uploader status route. After the deployed GuardDuty worker records a version-bound clean result, the authenticated completion route copies the exact quarantine version to the durable bucket, verifies S3 version/checksum/size/MIME/SSE-KMS metadata, creates `StoredObject(PENDING)`, and transactionally links the template, makes the object `AVAILABLE`, and writes strict audit evidence. No native S3 URL or storage location is returned to the browser.

Successful writers also make an opaque local compatibility copy because all staff file delivery remains unchanged until PR-5C. Consequently this writer migration is not enough for multi-instance or PHI-safe delivery. All file readers, cleanup automation, and infrastructure provisioning remain unchanged/deferred.

PR-5B.3 moved the remaining two writers onto the same pipeline. Staff supporting uploads now use a dedicated receipt route that runs the full live packet/client/organization authorization branch from query-string binding targets before any multipart byte is parsed, then requires the UUID idempotency key and the staff supporting validation profile (PDF, JPEG, PNG, DOCX); the legacy buffering server action was removed. Portal request uploads keep their request-derived identity, permission, and per-user-and-IP rate limiting at receipt, then stop at SCANNING; the SUBMITTED transition, SupportingDocument (PENDING_REVIEW), timeline event, strict portal audit, and portal notification all move into the portal completion transaction with the same race-safe conditional update as before. Portal-authenticated status and completion routes expose only opaque lifecycle state to the original uploader, and completion reauthorizes against live database state for both actor kinds.

Operationally deploy these routes only on the verified dedicated upload runtime. The GuardDuty plan, EventBridge rule, SQS/DLQ, worker hosting, IAM/KMS policies, alarms, private bucket controls, and BAA/service-coverage evidence must exist outside this repository. Use synthetic files only until the full PHI gate is approved.

No native signed URL is delivered to a user in PR-5A. The approved initial PR-5C design is application-authorized, application-proxied streaming. The dormant S3 capability requires a version-bound read and caps TTL at 60 seconds.

### Bucket Structure

```
separate durable/quarantine buckets per environment/account
└── organizations/{organizationId}/...
    ├── templates/{documentTemplateId}/source/{artifactId}.pdf
    ├── clients/{clientId}/packets/{packetId}/documents/{packetDocumentId}/versions/{pdfVersionId}.pdf
    ├── clients/{clientId}/supporting/{supportingDocumentId}/{artifactId}
    ├── clients/{clientId}/portal-requests/{requestId}/uploads/{supportingDocumentId}/{artifactId}
    └── uploads/{uploadAttemptId}/{artifactId}   # quarantine bucket only
```

### Bucket Policies

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Deny",
      "Principal": "*",
      "Action": "s3:*",
      "Resource": "arn:aws:s3:::higsi-production/*",
      "Condition": {
        "Bool": { "aws:SecureTransport": "false" }
      }
    }
  ]
}
```

- Block all public access (bucket policy + block public access settings)
- Access through application-authorized, application-proxied streaming initially
- Enable SSE-KMS with the approved customer-managed key
- Enable S3 versioning for document recovery
- Disable ACLs, require TLS, and use workload identity

These controls are required infrastructure work and are not provisioned by PR-5A. Malware scanning, backup/restore, Object Lock, finalization, and retention enforcement remain deferred. Preliminary planning targets are RPO 15 minutes and RTO four hours; neither is yet verified. An executed AWS BAA and confirmation of covered services remain mandatory before PHI.

---

## 8. Health Check Monitoring

### Endpoint

```
GET /api/health
```

### Response (200 — Healthy)

```json
{
  "status": "healthy",
  "ready": true,
  "version": "0.1.0",
  "environment": "production",
  "timestamp": "2026-07-08T00:00:00.000Z",
  "uptime": 86400,
  "durationMs": 45,
  "checks": {
    "database": "ok"
  }
}
```

### Response (503 — Degraded)

```json
{
  "status": "degraded",
  "ready": false,
  "version": "0.1.0",
  "environment": "production",
  "timestamp": "2026-07-08T00:00:00.000Z",
  "uptime": 3600,
  "durationMs": 5000,
  "checks": {
    "database": "error"
  }
}
```

### Monitoring Configuration

```yaml
# Uptime Robot / Better Uptime / Checkly
url: https://app.higsi.com/api/health
interval: 1 minute
method: GET
expected_status: 200
timeout: 10 seconds
alert_when: down_3_times
```

### Alert Thresholds

| Metric | Warning | Critical |
|---|---|---|
| Health check failure | 3 consecutive failures | 5 consecutive failures |
| Response time > 2s | 3 failures in 5 min | 5 failures in 5 min |
| Database check fails | Immediate alert | Page on-call |
| Error rate > 1% | Slack notification | Page on-call |

---

## 9. Rollback Process

### Prerequisites

- Previous Docker image tagged (or Vercel deployment retained)
- Database backup from before the deployment
- `prisma migrate resolve` available for migration rollback

### Rollback Types

#### Type 1: App-only rollback (no schema change)

```bash
# Vercel
vercel rollback <deployment-id>

# Railway
railway rollback
```

**Reverts the application code. Database is unchanged.**  
Safe for:
- Buggy code changes
- Configuration errors
- UI issues

#### Type 2: Migration rollback (schema change)

```bash
# 1. Identify the problematic migration
npx prisma migrate status

# 2. Roll back the migration
npx prisma migrate resolve --rolled-back <migration-name>

# 3. Manually revert any destructive SQL changes
#    (Prisma cannot auto-rollback destructive operations like DROP COLUMN)

# 4. Deploy the previous app version
vercel rollback <previous-deployment-id>
```

**Reverts schema + code.** Requires manual SQL for destructive operations.  
Safe for:
- Additive schema changes (new tables, new columns with defaults)
- Index changes

#### Type 3: Full database restore (data corruption)

```bash
# 1. Stop the application to prevent writes
vercel --pause

# 2. Restore database from backup
pg_restore --dbname=higsi_db --format=custom --clean --if-exists \
  /backups/higsi_db_20240701.dump

# 3. Restore file storage if needed
aws s3 sync s3://higsi-backups/20240701/ s3://higsi-production/

# 4. Deploy the previous app version
vercel rollback <previous-deployment-id>

# 5. Verify health endpoint returns 200
curl https://app.higsi.com/api/health

# 6. Resume traffic
vercel --unpause
```

**Full recovery from data corruption or security incident.**  
RTO: ~30 minutes, RPO: ~24 hours (last backup).

### Rollback Decision Tree

```
Issue detected
├─ Is it app-only (UI, logic, config)?
│  └─ ✅ Type 1: App rollback (fast, safe)
│
├─ Is it a failed migration?
│  ├─ Can the migration be rolled back?
│  │  ├─ ✅ Type 2: Migration rollback
│  │  └─ ❌ Type 3: Full DB restore
│
└─ Is it data corruption?
   └─ ✅ Type 3: Full database restore
```

---

## 10. Beta Launch Checklist

### Pre-Launch (2 weeks before)

- [ ] Security audit completed
- [ ] Penetration testing passed
- [ ] HIPAA controls verified (if required)
- [ ] All 39 tests passing in CI
- [ ] 0 lint errors
- [ ] Staging environment is operational
- [ ] Load test run on staging (1000 clients, 5000 packets)
- [ ] P95 response time < 500ms under load
- [ ] Login brute-force throttling implemented and verified (currently a gap — see "Known Gaps at Launch")
- [ ] File storage backup covers `private/data/`, not just the database (currently a gap — script only backs up DB)
- [ ] SSN field-level encryption/tokenization decision made and signed off by security

### Infrastructure (1 week before)

- [ ] Production database provisioned (PgBouncer + PostgreSQL)
- [ ] Redis provisioned for rate limiting
- [ ] S3 bucket created with proper policies
- [ ] Sentry project created and DSN configured
- [ ] Domain DNS configured (app.higsi.com)
- [ ] SSL certificate issued (auto via Vercel)
- [ ] Production environment variables set
- [ ] CI/CD pipeline deployed and tested
- [ ] Backup cron job configured

### Deployment Day

- [ ] Run `npm run migrate:deploy` against production database
- [ ] Verify `/api/health` returns 200
- [ ] Deploy application
- [ ] Verify login flow works
- [ ] Verify PDF upload and rendering
- [ ] Create a test client → packet → document → validate → sign → approve
- [ ] Verify Sentry captures test error (trigger known-error page)
- [ ] Verify rate limiting (trigger 429 on upload)
- [ ] Monitor logs for errors (first 10 minutes)
- [ ] Announce to beta users

### Post-Launch Monitoring (First 24 hours)

- [ ] Error rate < 0.1%
- [ ] P95 response time < 1s
- [ ] No unhandled exceptions
- [ ] Database connection pool not exhausted
- [ ] Rate limits not exceeded by legitimate users
- [ ] Sentry no alerts triggered
- [ ] Health endpoint always 200

### GO / NO-GO Criteria

| Criterion | Go | No-Go |
|---|---|---|
| All tests passing | ✅ | ❌ |
| 0 P1 security issues | ✅ | ❌ |
| Backup confirmed working | ✅ | ❌ |
| SSL valid | ✅ | ❌ |
| Health endpoint 200 | ✅ | ❌ |
| Sentry DSN configured | ✅ | ❌ |
| Rollback plan documented | ✅ | ❌ |

### Contact Sheet

| Role | Name | Phone | Email |
|---|---|---|---|
| Lead Engineer | TBD | TBD | TBD |
| DevOps | TBD | TBD | TBD |
| Security Officer | TBD | TBD | TBD |
| On-call (week 1) | TBD | TBD | TBD |

---

## Appendices

### A. Quick Reference Commands

```bash
# Deploy
git push origin main
# CI/CD handles the rest

# Manual migration
npx prisma migrate deploy

# Backup
./scripts/backup.sh

# Restore
pg_restore --dbname=higsi_db --clean backups/latest.dump

# Rollback
vercel rollback $(vercel list --previous | head -2 | tail -1 | awk '{print $2}')

# Health check
curl https://app.higsi.com/api/health

# View logs
vercel logs --tail
```

### B. Architecture Diagram

```
User → DNS (Vercel) → Edge Network
                        ├── /api/* → Serverless Functions
                        ├── /api/health → Public (no auth)
                        ├── /_next/* → Static (CDN cached)
                        └── /* → SSR Pages (auth-protected via proxy)
                              │
                              ▼
                        Server Actions (NextAuth → JWT)
                              │
                        ┌─────┴─────┐
                        │           │
                        ▼           ▼
                  PostgreSQL     S3 Storage
                  (Prisma)    (App-proxied target)
                        │
                        ▼
                  Redis (rate limiting)
                        │
                        ▼
                  Sentry (error tracking)
```

### C. Cost Estimates (Monthly)

| Service | Plan | Estimated Cost |
|---|---|---|
| Vercel Pro | Team plan | $20/mo |
| PostgreSQL (Railway) | 2GB RAM | $15/mo |
| Redis (Upstash) | 10MB/day | $0 (free tier) |
| S3 (AWS) | 5GB storage | $1/mo |
| Sentry | Team plan | $26/mo |
| Domain | .com | $12/yr |
| **Total** | | **~$75/mo** |
