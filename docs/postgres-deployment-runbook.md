# PostgreSQL Deployment Runbook

This runbook is for CloudBase environments that provide PostgreSQL management instead of the CloudBase JSON database.

Do not put real database passwords, connection strings, COS credentials, peppers, redemption codes, or recovery codes in this repository.

## Current Local Artifacts

Generated private files:

- PostgreSQL schema SQL: `/tmp/office-templates-postgres-schema.private.sql`
- PostgreSQL template import SQL: `/tmp/office-templates-postgres-templates-import.private.sql`

These files are private local handoff artifacts. They are not committed.

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

Expected result:

- 8 tables exist.
- `templates` has 1319 rows.
- Other runtime tables exist and start empty.
- Unique indexes exist for device IDs, template IDs, code digests, recovery digests, idempotency keys, and daily quota records.

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

The project is not deployed until the production service is running with `POSTGRES_URL`, COS signing variables, and the target commit. Database setup alone is not a deployed service.
