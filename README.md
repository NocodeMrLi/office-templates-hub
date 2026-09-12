# Office Templates Hub

AI-ready search and secure delivery service for 1,300+ professionally designed Chinese workplace Excel templates.

## Current status

Local backend development is in progress. The service is not deployed, payment is not enabled, and template files are not stored in this public repository.

Implemented locally:

- versioned, idempotent schema migration contract for eight collections;
- device registration with a 256-bit secret and server-side HMAC digest only;
- device authentication, disable handling, and secret rotation;
- idempotent `POST /api/device/register`, including concurrent retry coalescing;
- dependency-aware `GET /api/health`;
- validated and paginated public catalog domain service;
- public-repository scanning for spreadsheet binaries, private fields, local paths, and Tencent secret IDs.

Planned API surface:

- `GET /api/catalog`
- `POST /api/search`
- `POST /api/device/register`
- `POST /api/download`
- `POST /api/redeem`
- `POST /api/recover`
- `GET /api/health`

## Development

Requires Node.js 22+ and pnpm 11.19.0.

```bash
pnpm install
pnpm verify
```

Copy `.env.example` to a local secret-managed environment. Never commit real credentials, redemption codes, recovery codes, object keys, signed URLs, or `.xlsx` files.
