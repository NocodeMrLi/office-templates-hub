# CloudBase PostgreSQL Runbook

This runbook manages the PostgreSQL document tables used by the office-spreadsheet service. Never place real passwords, connection strings, COS credentials, peppers, API keys, plaintext redemption/recovery codes, or signed URLs in the repository, docs, chat, prompts, or logs.

## Current database state (verified 2026-09-20)

The target CloudBase PostgreSQL environment has:

- `templates`: total 1319; distinct `public_id` 1319; `status=active` 1319;
- `asset_scope=public`: 1319; missing scope 0; enterprise-private scope 0;
- invalid `object_key`: 0;
- `codes`: three retained digest-only historical test records; these do not enable a personal payment flow and contain no plaintext code field.

The template scope migration was executed only after MCP dry-run and was verified by a read-only aggregate query. This means **metadata is imported and verified**. It does not mean the runtime is deployed or the product is online.

## Import contract

`scripts/template-import-data.ts` now writes `asset_scope: "public"` for every public catalog item. SQL imports remain idempotent with logical unique keys and `ON CONFLICT DO NOTHING`.

Before importing or refreshing templates:

1. verify the public catalog count and uniqueness;
2. verify the private COS manifest maps every public ID to one object key and SHA;
3. run source-file and import safety scans;
4. dry-run the SQL through the approved platform tool;
5. execute only after operator confirmation;
6. re-query totals, distinct IDs, status, scope distribution, and object-key validity.

Never replace all documents or remove fields merely to change access policy. The scope migration is additive and idempotent.

## Expected tables

- `templates`, `devices`, `codes`, `entitlements`, `usage_daily`, `recovery_codes`, `download_events`, `registration_results`.

Required logical uniqueness includes template public ID, device ID, code digest, source order ID, daily usage key, recovery digest, and idempotency keys as defined by `scripts/postgres-schema.ts`.

## Safe aggregate verification

Use the CloudBase PostgreSQL read-only query tool to verify only aggregate state. Do not paste the connection string into a shell command or report.

Expected template result:

```text
total=1319
distinct_public_ids=1319
active=1319
public_scope=1319
enterprise_private_scope=0
missing_scope=0
invalid_object_keys=0
```

For future enterprise-private assets, update the expectation intentionally and add tenant-isolation tests before any import. Public and enterprise-private data must never be inferred from a retired personal access field.

## Deployment boundary

PostgreSQL import and verification are separate from COS verification, service deployment, online API tests, payment, and launch. Current state: database imported/verified; COS verified; runtime service not deployed; online end-to-end not verified; product not online.
