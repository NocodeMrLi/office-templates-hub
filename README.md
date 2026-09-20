# Office Templates Hub

Office spreadsheet Skill infrastructure built around 1319 professional public assets, versioned business standards, controlled asset adaptation, standard-driven generation, and evidence-backed quality validation.

## Product flow

```text
exact public asset → direct delivery
otherwise → verify the closest asset is genuinely applicable → adapt it
otherwise → generate from versioned public standards
then → validate fields, structure, workflow, formulas, print setup, and compatibility
insufficient evidence → clarify, explicitly labelled draft, or refuse
```

Personal users receive the complete public capability free of charge. Enterprise payment is reserved for private assets and rules, team permissions, versioning, batch work, enterprise API/MCP, quotas, audit, private deployment, and customization. Retained legacy entitlement/payment code is not the personal primary flow.

## Current status

**Locally implemented and verified:**

- all 1319 catalog assets are exposed as `asset_scope=public` and `availability=public_free`;
- public downloads no longer require a personal paid entitlement or consume the legacy daily quota; explicit `enterprise_private` remains fail-closed;
- 263 public business standards are distilled from 1319 assets in the versioned `data/standards.public.json` snapshot;
- one `OfficeSpreadsheetEngine` handles exact delivery, applicable-asset adaptation, standard generation, clarification, labelled drafts, and refusal;
- `POST /api/spreadsheets/resolve` and the local `skill/SKILL.md` entry call that same engine;
- deterministic XLSX rendering and quality checks cover required fields, duplicate columns, workflow, formula safety, print settings, and Excel/WPS/LibreOffice compatibility targets;
- HTTP runtime and the local Skill load the same schema-validated active standard snapshot and fail closed when it is invalid or does not match the catalog;
- new-asset standard scanning produces limited-dimension review candidates or `no_change` records; persistent promotion writes immutable versions and a change record before atomically activating the new snapshot, and rollback is audited;
- PostgreSQL/CloudBase repositories, COS signing, migrations, imports, production build/smoke, public scan, and deployment preflight remain available.

**Cloud data verified:** PostgreSQL contains 1319 active public-scope template records with 1319 distinct public IDs, and all 1319 COS objects currently match the private manifest by content size and SHA.

**Not deployed / not online:** no CloudBase runtime service or deployed URL exists, so online API and download end-to-end verification have not occurred.

**Planned, not implemented:** enterprise tenants, private-asset isolation, API keys, enterprise permissions/quotas/audit, MCP adapter, and enterprise payment provisioning.

## Development

Requires Node.js 22+ and pnpm 11.19.0.

```bash
pnpm install
pnpm verify
```

Verify that the active snapshot matches the public catalog:

```bash
pnpm standards:verify-active
```

Build an explicitly versioned candidate without overwriting the active snapshot:

```bash
pnpm standards:build -- --version 1.0.1 --output /tmp/standards.candidate.json
```

Resolve a local Skill request:

```bash
pnpm --silent skill:resolve -- --request request.json --output result.xlsx
```

Scan newly admitted assets against the active standard snapshot:

```bash
pnpm standards:scan -- data/standards.public.json new-assets.json evolution-report.json
```

A scan never publishes a standard. After human approval and successful regression, use the controlled commands below; replace angle-bracket values with reviewed local paths/identifiers:

```bash
EVOLUTION_REPORT=/absolute/path/evolution-report.json
FORMAL_STANDARD_DOC=/absolute/path/public-standard-document.md
REVIEWER_ID=reviewer-id
CURRENT_VERSION=1.0.0

pnpm standards:promote -- \
  --active data/standards.public.json \
  --history data/standards-history \
  --report "$EVOLUTION_REPORT" \
  --approved-by "$REVIEWER_ID" \
  --regression-passed true \
  --rollback-version "$CURRENT_VERSION"

pnpm standards:docs:sync -- \
  --snapshot data/standards.public.json \
  --document "$FORMAL_STANDARD_DOC"

pnpm standards:rollback -- \
  --active data/standards.public.json \
  --history data/standards-history \
  --target-version "$CURRENT_VERSION" \
  --approved-by "$REVIEWER_ID" \
  --reason "reviewed rollback reason"
```

C01-A is locally implemented and verified, including a temporary `1.0.0 → 1.0.1 → 1.0.0` drill. This does not mean the service is deployed or online.

Copy `.env.example` only as a variable-name template. Never commit or print real database credentials, connection strings, SecretKey values, API keys, plaintext redemption/recovery codes, signed URLs, private import files, or `.xlsx` assets.

Deployment boundaries and operator steps:

- [CloudBase deployment runbook](docs/cloudbase-deployment-runbook.md)
- [CloudBase PostgreSQL runbook](docs/postgres-deployment-runbook.md)
