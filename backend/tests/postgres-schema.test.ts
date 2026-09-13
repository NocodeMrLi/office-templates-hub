import { describe, expect, test } from "vitest";

import { buildPostgresSchemaSql } from "../../scripts/postgres-schema.js";

describe("buildPostgresSchemaSql", () => {
  test("creates the JSONB runtime tables and required unique indexes", () => {
    const sql = buildPostgresSchemaSql();

    for (const table of [
      "templates",
      "devices",
      "codes",
      "entitlements",
      "usage_daily",
      "recovery_codes",
      "download_events",
      "registration_results",
    ]) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}" (doc jsonb NOT NULL);`);
    }
    expect(sql).toContain('"templates_public_id_uidx"');
    expect(sql).toContain('"usage_daily_device_id_date_uidx"');
    expect(sql).toContain("(doc->>'device_id'), (doc->>'date')");
    expect(sql).toContain('"registration_results_idempotency_key_uidx"');
  });
});
