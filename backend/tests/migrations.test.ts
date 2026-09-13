import { describe, expect, test } from "vitest";

import {
  COLLECTIONS,
  runMigrations,
  type MigrationStore,
} from "../src/migrations/run-migrations.js";

class TestMigrationStore implements MigrationStore {
  readonly collections = new Map<string, Set<string>>();
  readonly applied = new Set<string>();

  async hasMigration(id: string): Promise<boolean> {
    return this.applied.has(id);
  }

  async createCollection(name: string): Promise<void> {
    if (!this.collections.has(name)) {
      this.collections.set(name, new Set());
    }
  }

  async createUniqueIndex(collection: string, fields: readonly string[]): Promise<void> {
    const indexes = this.collections.get(collection);
    if (!indexes) {
      throw new Error(`missing collection: ${collection}`);
    }
    indexes.add(fields.join("+"));
  }

  async recordMigration(id: string): Promise<void> {
    this.applied.add(id);
  }
}

describe("runMigrations", () => {
  test("creates the eight documented collections and required unique indexes", async () => {
    const store = new TestMigrationStore();

    const result = await runMigrations(store);

    expect([...store.collections.keys()].sort()).toEqual([...COLLECTIONS].sort());
    expect(store.collections.get("templates")).toContain("public_id");
    expect(store.collections.get("devices")).toContain("device_id");
    expect(store.collections.get("codes")).toContain("code_digest");
    expect(store.collections.get("entitlements")).toContain("source_order_id");
    expect(store.collections.get("usage_daily")).toContain("device_id+date");
    expect(store.collections.get("recovery_codes")).toContain("recovery_digest");
    expect(store.collections.get("download_events")).toContain("device_id+idempotency_key");
    expect(store.collections.get("registration_results")).toContain("idempotency_key");
    expect(result.applied).toEqual(["001-initial-schema"]);
  });

  test("is idempotent when the same migration runs twice", async () => {
    const store = new TestMigrationStore();

    await runMigrations(store);
    const second = await runMigrations(store);

    expect(second).toEqual({ applied: [], skipped: ["001-initial-schema"] });
    expect(store.applied).toEqual(new Set(["001-initial-schema"]));
    expect(store.collections.size).toBe(8);
  });
});
