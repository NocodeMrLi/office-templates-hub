import { describe, expect, test } from "vitest";

import {
  DocumentStorePostgresCollection,
  type PostgresQueryClient,
  type PostgresQueryResult,
} from "../src/infrastructure/document-store-postgres-adapter.js";

class FakePostgresClient implements PostgresQueryClient {
  readonly calls: Array<{ sql: string; values: unknown[] }> = [];
  readonly results: Array<PostgresQueryResult> = [];

  async query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    values: unknown[] = [],
  ): Promise<PostgresQueryResult<T>> {
    this.calls.push({ sql, values });
    const result = this.results.shift() ?? { rows: [], rowCount: 0 };
    return result as PostgresQueryResult<T>;
  }
}

describe("DocumentStorePostgresCollection", () => {
  test("finds one JSONB document by simple document fields", async () => {
    const client = new FakePostgresClient();
    client.results.push({ rows: [{ doc: { device_id: "device-1", status: "active" } }], rowCount: 1 });
    const collection = new DocumentStorePostgresCollection({ table: "devices", client });

    await expect(collection.findOne({ device_id: "device-1", status: "active" })).resolves.toEqual({
      device_id: "device-1",
      status: "active",
    });

    expect(client.calls[0]?.sql).toContain("SELECT doc FROM \"devices\"");
    expect(client.calls[0]?.sql).toContain("doc->>'device_id' = $1");
    expect(client.calls[0]?.sql).toContain("doc->>'status' = $2");
    expect(client.calls[0]?.values).toEqual(["device-1", "active"]);
  });

  test("updates one matching JSONB document and treats missing-or-null fields as null", async () => {
    const client = new FakePostgresClient();
    client.results.push({ rows: [], rowCount: 1 });
    const collection = new DocumentStorePostgresCollection({ table: "codes", client });

    await expect(collection.updateOne(
      { code_digest: "digest-1", redeemed_at: null },
      { redeemed_by_device_id: "device-1", redeemed_at: "2026-09-13T00:00:00.000Z" },
    )).resolves.toEqual({ modifiedCount: 1 });

    expect(client.calls[0]?.sql).toContain("UPDATE \"codes\"");
    expect(client.calls[0]?.sql).toContain("(NOT (doc ? 'redeemed_at') OR doc->'redeemed_at' = 'null'::jsonb)");
    expect(client.calls[0]?.values).toEqual([
      "digest-1",
      JSON.stringify({ redeemed_by_device_id: "device-1", redeemed_at: "2026-09-13T00:00:00.000Z" }),
    ]);
  });

  test("returns false for duplicate insert-if-absent conflicts", async () => {
    const client = new FakePostgresClient();
    client.query = async () => {
      throw { code: "23505" };
    };
    const collection = new DocumentStorePostgresCollection({ table: "registration_results", client });

    await expect(collection.insertIfAbsent({ idempotency_key: "key-1" })).resolves.toEqual({ inserted: false });
  });

  test("finds active entitlement with date range predicates", async () => {
    const client = new FakePostgresClient();
    client.results.push({ rows: [{ doc: { device_id: "device-1", source_order_id: "order-1" } }], rowCount: 1 });
    const collection = new DocumentStorePostgresCollection({ table: "entitlements", client });

    await expect(collection.findActive("device-1", "2026-09-13T00:00:00.000Z")).resolves.toEqual({
      device_id: "device-1",
      source_order_id: "order-1",
    });
    expect(client.calls[0]?.sql).toContain("doc->>'starts_at' <= $2");
    expect(client.calls[0]?.sql).toContain("doc->>'expires_at' > $2");
    expect(client.calls[0]?.values).toEqual(["device-1", "2026-09-13T00:00:00.000Z"]);
  });

  test("consumes daily quota through insert-on-conflict plus atomic used increment", async () => {
    const client = new FakePostgresClient();
    client.results.push(
      { rows: [], rowCount: 0 },
      { rows: [{ doc: { device_id: "device-1", date: "2026-09-13", used: 2 } }], rowCount: 1 },
    );
    const collection = new DocumentStorePostgresCollection({
      table: "usage_daily",
      client,
      now: () => new Date("2026-09-13T00:00:00.000Z"),
    });

    await expect(collection.consumeOne("device-1", "2026-09-13", 5)).resolves.toEqual({ allowed: true, used: 2 });
    expect(client.calls[0]?.sql).toContain("ON CONFLICT ((doc->>'device_id'), (doc->>'date')) DO NOTHING");
    expect(client.calls[1]?.sql).toContain("COALESCE((doc->>'used')::integer, 0) < $3");
    expect(client.calls[1]?.sql).toContain("RETURNING doc");
    expect(client.calls[1]?.values).toEqual(["device-1", "2026-09-13", 5, "2026-09-13T00:00:00.000Z"]);
  });
});
