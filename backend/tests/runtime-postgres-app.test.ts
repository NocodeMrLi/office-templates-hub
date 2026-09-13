import { describe, expect, test } from "vitest";

import {
  createRuntimeApp,
  createRuntimeRepositoriesForPostgres,
} from "../src/runtime-app.js";
import type { PostgresQueryClient, PostgresQueryResult } from "../src/infrastructure/document-store-postgres-adapter.js";

class MinimalPostgresClient implements PostgresQueryClient {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  fail = false;

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<PostgresQueryResult<T>> {
    this.calls.push({ sql, values });
    if (this.fail) {
      throw new Error("postgres unavailable");
    }
    return { rows: [], rowCount: 0 };
  }
}

describe("runtime PostgreSQL app wiring", () => {
  test("builds the full PostgreSQL repository set and probes database health", async () => {
    const client = new MinimalPostgresClient();
    const repositories = createRuntimeRepositoriesForPostgres(client);

    expect(Object.keys(repositories).sort()).toEqual([
      "codes",
      "devices",
      "downloadEvents",
      "entitlements",
      "health",
      "recoveryCodes",
      "registrationResults",
      "templates",
      "usage",
    ]);
    await expect(repositories.health()).resolves.toBe("ok");
    expect(client.calls[0]).toEqual({ sql: "SELECT 1", values: [] });

    client.fail = true;
    await expect(repositories.health()).resolves.toBe("unavailable");
  });

  test("creates an app with injected PostgreSQL client", async () => {
    const app = await createRuntimeApp({
      devicePepper: "device-pepper",
      codePepper: "code-pepper",
      recoveryPepper: "recovery-pepper",
      postgres: {
        connectionString: "postgres://user:pass@example.test:5432/app",
        client: new MinimalPostgresClient(),
      },
    });

    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.json()).toMatchObject({
      status: "degraded",
      dependencies: {
        database: "ok",
        object_storage: "not_configured",
      },
    });
  });
});
