# CloudBase Deployment Runbook

This runbook covers the next deployment of the public office-spreadsheet core. It contains no real environment IDs, bucket names, credentials, signed URLs, redemption codes, or private paths.

## Current evidence boundary (2026-09-20)

- Local Skill, public-free catalog/download semantics, shared standards engine, resolve API, XLSX rendering, quality gate, and standard-evolution gate are implemented and locally verified.
- CloudBase PostgreSQL has 1319 active, distinct, public-scope template records; missing scope and invalid object paths are 0.
- COS content verification passed for 1319/1319 objects by read-only object size and SHA. The current credential cannot call `HeadObject`, so the verifier correctly falls back to read-only `GetObject`; a 403 is not reported as a missing object.
- No CloudBase runtime service is deployed. No online API, signed-download, or user end-to-end verification exists. The product is not online.
- Enterprise tenants, API keys, permissions/quotas/audit, MCP, and enterprise payment provisioning are not implemented.

Do not mark the service deployed until the exact candidate commit is running in the target environment. Do not mark it online verified until every cloud smoke below passes against the deployed URL.

## Runtime configuration

Use the platform secret/environment manager for variable values:

- `POSTGRES_URL` and `POSTGRES_SSL`, or `CLOUDBASE_ENV_ID` for the alternate JSON-database route—never both providers;
- `DEVICE_SECRET_PEPPER`, `CODE_SECRET_PEPPER`, `RECOVERY_SECRET_PEPPER`;
- `COS_SECRET_ID`, `COS_SECRET_KEY`, `COS_BUCKET`, `COS_REGION`, `COS_OBJECT_PREFIX`, `COS_SIGN_EXPIRES_SECONDS`;
- `HOST`, `PORT`, `CORS_ALLOWLIST`.

Partial COS configuration fails closed. Complete secret values must never enter docs, Git, chat, prompts, screenshots, frontend code, or logs.

## Candidate preflight

From a clean checkout of the exact candidate commit:

```bash
pnpm install --frozen-lockfile
pnpm standards:build
pnpm verify
pnpm tsx scripts/deployment-preflight.ts \
  --commit-sha "$(git rev-parse HEAD)" \
  --verify-passed true \
  --bundle <private-import-bundle> \
  --export-dir <private-import-export-dir> \
  --env-example .env.example
```

Expected: all tests/build/smoke/public scan pass; the regenerated standard snapshot has 1319 source assets and 263 standards; import artifacts and checksums match; `.env.example` contains placeholders only. A missing local Docker engine is a documented warning, not proof of an image build.

## Deployment sequence

1. Confirm the worktree is clean and local HEAD equals `origin/main`.
2. Confirm PostgreSQL aggregate evidence: total/distinct/active/public scope all 1319; missing scope and invalid object paths 0.
3. Confirm COS full content verification is still 1319/1319.
4. Configure runtime variables in the platform secret manager.
5. Deploy the exact commit with `pnpm build` and `pnpm start`, or the repository Dockerfile.
6. Record sanitized evidence: commit SHA, environment/region, deployment time, service URL, health status, and smoke results.

## Online smoke gate

Run against the deployed URL:

- `GET /api/health`: database and object storage `ok`;
- `GET /api/catalog`: public-only fields, no legacy access field or private data;
- `POST /api/search`: public candidates without quota consumption;
- `POST /api/spreadsheets/resolve`: exact, adapt, generate, clarify, draft, and refuse representative cases invoke the shared engine;
- `POST /api/device/register`: idempotent retry returns one stable credential result;
- `POST /api/download`: every sampled public asset returns a valid signed download without personal paid entitlement or legacy quota deduction;
- downloaded size and SHA match the API response/private manifest;
- explicit enterprise-private test records remain inaccessible;
- repeated idempotency key with the same request is stable; changed parameters conflict.

Retained `/api/redeem` and `/api/recover` routes are not part of the personal public primary flow. Do not configure a personal subscription product.

## Do not claim without evidence

Do not claim deployed, online verified, production ready, released, user accepted, enterprise API available, MCP available, or payment available unless the corresponding deployment and end-to-end evidence exists.
