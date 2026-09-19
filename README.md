# Office Templates Hub

Workplace spreadsheet Skill infrastructure built around professional public assets, reusable business standards, and evidence-backed quality validation.

The target user flow is: exact public-asset match and direct delivery; otherwise select a genuinely applicable nearby asset and adapt it; if no asset is suitable, generate from approved standards; then validate fields, structure, workflow, formulas, print layout, and compatibility. Insufficient evidence must lead to clarification, a clearly labelled draft, or refusal—not invented professional content.

Personal users are intended to receive the complete public capability free of charge. Enterprise payment is intended for private assets and rules, team permissions, versioning, batch work, API/MCP access, quotas, audit, private deployment, and customization. The legacy personal paid-unlock code remains in the repository for migration history and possible future enterprise reuse, but it is not the target personal product flow.

## Current status

Baseline audit and product-position migration are in progress. The service is **not deployed** and **not online**; payment is not enabled; template binaries are not stored in this public repository.

Implemented locally:

- versioned, idempotent schema migration contract for eight collections;
- device registration with a 256-bit secret and server-side HMAC digest only;
- device authentication, disable handling, and secret rotation;
- idempotent `POST /api/device/register`, including concurrent retry coalescing;
- dependency-aware `GET /api/health`;
- validated and paginated public catalog domain service;
- local `GET /api/catalog`, `GET /api/health`, `POST /api/search`, `POST /api/download`, `POST /api/redeem`, `POST /api/recover`, and `POST /api/device/register` routes;
- COS download signing adapter and local degraded mode when COS is intentionally not configured;
- CloudBase collection adapter for the runtime database repositories;
- template and redemption-code import tooling for private CloudBase data handoff;
- production build, production health smoke, Dockerfile, and deployment preflight checks;
- public-repository scanning for spreadsheet binaries, private fields, local paths, and Tencent secret IDs.

Not yet implemented:

- installable local Skill and `SKILL.md`;
- unified asset-standard engine shared by local Skill, HTTP API, and MCP;
- structured standard-driven generation/adaptation and generated-output quality validation;
- recurring new-asset scan and controlled standard-upgrade loop;
- personal-free access to every public asset (the current runtime still enforces the legacy paid tier for some records);
- enterprise tenants, private asset isolation, API keys, enterprise quotas/audit, and enterprise payment provisioning;
- MCP adapter;
- cloud deployment and online end-to-end verification.

The existing HTTP routes are a local legacy backend foundation, not a released enterprise API. API is the intended core service entry point; MCP will be an Agent-facing adapter over the same engine, not a separate rule implementation.

## Development

Requires Node.js 22+ and pnpm 11.19.0.

```bash
pnpm install
pnpm verify
```

Copy `.env.example` to a local secret-managed environment. Never commit real credentials, redemption codes, recovery codes, signed URLs, or `.xlsx` files. Do not place API keys in a Skill file, prompt, frontend, repository, chat, or logs.

CloudBase JSON database deployment handoff steps are documented in [docs/cloudbase-deployment-runbook.md](docs/cloudbase-deployment-runbook.md).
CloudBase PostgreSQL deployment handoff steps are documented in [docs/postgres-deployment-runbook.md](docs/postgres-deployment-runbook.md).
