# PostgreSQL Deployment Runbook

This runbook is for CloudBase environments that provide PostgreSQL management instead of the CloudBase JSON database.

Do not put real database passwords, connection strings, COS credentials, peppers, redemption codes, or recovery codes in this repository.

## Current Local Artifacts

Generated private files:

- PostgreSQL schema SQL: `/tmp/office-templates-postgres-schema.private.sql`
- PostgreSQL template import SQL: `/tmp/office-templates-postgres-templates-import.private.sql`
- PostgreSQL template import chunks: `/tmp/office-templates-postgres-import-chunks.private/templates-001.sql` through `templates-014.sql`
- Afdian 31-day sales-test plaintext codes: local private delivery file outside the repository; do not commit, paste, or screenshot the codes.
- Afdian 31-day sales-test digest import data: `/tmp/office-templates-afdian-month-sales-test-20260913-import.private.json`
- PostgreSQL Afdian sales-test codes import SQL: `/tmp/office-templates-postgres-codes-import.private.20260913-2308.sql`

These files are private local handoff artifacts. They are not committed.

## Current CloudBase PostgreSQL Import Status

The import records below are database evidence only. They do not prove COS availability, backend deployment, online API availability, payment availability, or product launch.

As of 2026-09-13 22:44 CST, the `office-templates-dev-d3aac865706` CloudBase PostgreSQL environment has the template catalog metadata imported and verified.

- Before import: `templates` had 860 rows.
- After idempotent completion import: `templates` has 1319 rows.
- Read-only verification: total 1319, distinct `public_id` 1319, active 1319, free 500, paid 819, invalid `object_key` 0.
- Runtime tables checked during this pass: `devices` 0, `download_events` 0, `entitlements` 0.

As of 2026-09-13 23:08 CST, the first Afdian 31-day monthly subscription sales-test code batch is imported and verified in PostgreSQL `codes` as digests only.

- Before import: `codes` had 0 rows.
- After idempotent import: `codes` has 3 rows and 3 distinct `code_digest` values.
- Distribution: type `afdian_month`, status `active`, value `31`, count 3.
- Safety verification: plaintext `code` field count 0; redeemed count for this batch 0.
- Idempotency verification: re-running the same import kept total/distinct at 3/3.

This status means template metadata and the first Afdian sales-test code digests are imported and verified. It does not mean the CloudBase service is deployed, the platform product is configured, or the product is online.

### 2026-09-19 read-only re-verification

- `templates`: total 1319, distinct public IDs 1319, active 1319, invalid object locations 0.
- Legacy compatibility distribution: 500/819. This is not the current personal entitlement policy; the upgraded target is free personal use of all public assets.
- `codes`: total 3, distinct digests 3, active 3, plaintext-code fields 0, redeemed 0. These are retained historical test records, not proof of an enabled personal subscription product.
- Runtime activity tables checked in this pass are empty, including devices, entitlements, downloads, usage, recovery, and registration results.
- Cloud Run is unopened and has no service. Therefore the runtime is not deployed, the API is not online verified, and the download chain is not online verified.
- Current COS verification is unable to complete because authorization/configuration returns HTTP 403; do not translate this into either “objects are missing” or “objects are verified.”

## Runtime Variables

Configure these in the platform environment variable manager:

- `POSTGRES_URL`
- `POSTGRES_SSL`
- `DEVICE_SECRET_PEPPER`
- `CODE_SECRET_PEPPER`
- `RECOVERY_SECRET_PEPPER`
- `COS_SECRET_ID`
- `COS_SECRET_KEY`
- `COS_BUCKET`
- `COS_REGION`
- `COS_OBJECT_PREFIX`
- `COS_SIGN_EXPIRES_SECONDS`

Set only one database provider:

- PostgreSQL route: set `POSTGRES_URL`, leave `CLOUDBASE_ENV_ID` empty.
- CloudBase JSON route: set `CLOUDBASE_ENV_ID`, leave `POSTGRES_URL` empty.

## Database Setup

Open PostgreSQL Management, then use the SQL editor to run:

1. The schema SQL from the private schema file.
2. The template import SQL from the private template import file.
3. Only for an explicitly approved migration or future enterprise test, run the private digest-only codes import SQL. The legacy personal Afdian subscription is not the current product flow.

If the SQL editor rejects a large paste or times out, use the chunked files instead:

1. Run `templates-001.sql`.
2. Wait for success.
3. Continue in order through `templates-014.sql`.
4. Do not skip a number or run the same chunk twice unless the failed chunk transaction was fully rolled back.

Expected result:

- 8 tables exist.
- `templates` has 1319 rows.
- Other runtime tables exist and start empty unless an explicitly approved test has populated them.
- Unique indexes exist for device IDs, template IDs, code digests, recovery digests, idempotency keys, and daily quota records.

Do not paste database passwords, connection strings, secret keys, peppers, redemption codes, or recovery codes into chat when asking for help. A screenshot of a generic SQL error is okay after cropping hidden credentials.

## Verification SQL

Run these after import:

```sql
SELECT COUNT(*) FROM "templates";
SELECT doc->>'public_id' AS public_id, doc->>'status' AS status
FROM "templates"
LIMIT 1;
SELECT COUNT(*) FROM "devices";
SELECT COUNT(*) FROM "download_events";
```

Expected:

- `templates` count is `1319`.
- The sample template status is `active`.
- `devices` and `download_events` are `0` before cloud smoke tests.

## Deployment Boundary

The project is not deployed until the production service is running with `POSTGRES_URL`, verified COS signing authorization, and the target commit. Database setup alone is not a deployed service. Deployment alone would still not prove online product readiness: the personal-free/public and enterprise-private boundary must be migrated and verified separately.
