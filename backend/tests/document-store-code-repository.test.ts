import { describe, expect, test } from "vitest";

import { DocumentStoreCodeRepository } from "../src/infrastructure/document-store-code-repository.js";

class FakeCodeCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly updates: Array<{ filter: Record<string, unknown>; patch: Record<string, unknown> }> = [];

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    return structuredClone(this.documents.get(String(filter.code_digest)) ?? null);
  }

  async updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }> {
    this.updates.push({ filter, patch });
    const current = this.documents.get(String(filter.code_digest));
    if (!current || current.redeemed_at !== filter.redeemed_at) {
      return { modifiedCount: 0 };
    }
    this.documents.set(String(filter.code_digest), { ...current, ...patch });
    return { modifiedCount: 1 };
  }
}

describe("DocumentStoreCodeRepository", () => {
  test("maps active imported redeem code documents", async () => {
    const collection = new FakeCodeCollection();
    collection.documents.set("digest-1", {
      code_digest: "digest-1",
      type: "afdian_month",
      status: "active",
      source_order_id: "afdian-20260913-0001",
      created_at: "2026-09-13T00:00:00.000Z",
      redeemed_by_device_id: "device-old",
      redeemed_at: "2026-09-14T00:00:00.000Z",
    });

    const repository = new DocumentStoreCodeRepository(collection);

    await expect(repository.findByDigest("digest-1")).resolves.toEqual({
      codeDigest: "digest-1",
      type: "afdian_month",
      status: "active",
      sourceOrderId: "afdian-20260913-0001",
      createdAt: new Date("2026-09-13T00:00:00.000Z"),
      redeemedByDeviceId: "device-old",
      redeemedAt: new Date("2026-09-14T00:00:00.000Z"),
    });
  });

  test("marks a code as redeemed with a conditional update", async () => {
    const collection = new FakeCodeCollection();
    collection.documents.set("digest-2", {
      code_digest: "digest-2",
      type: "afdian_month",
      status: "active",
      source_order_id: "afdian-20260913-0002",
      created_at: "2026-09-13T00:00:00.000Z",
      redeemed_at: null,
    });
    const redeemedAt = new Date("2026-09-15T00:00:00.000Z");
    const repository = new DocumentStoreCodeRepository(collection);

    await expect(repository.markRedeemed("digest-2", "device-1", redeemedAt)).resolves.toBe(true);
    await expect(repository.markRedeemed("digest-2", "device-2", redeemedAt)).resolves.toBe(false);
    expect(collection.updates[0]).toEqual({
      filter: { code_digest: "digest-2", redeemed_at: null },
      patch: { redeemed_by_device_id: "device-1", redeemed_at: redeemedAt.toISOString() },
    });
    expect(collection.documents.get("digest-2")).toMatchObject({
      redeemed_by_device_id: "device-1",
      redeemed_at: redeemedAt.toISOString(),
    });
  });
});
