import { describe, expect, test } from "vitest";

import { DocumentStoreUsageQuotaRepository } from "../src/infrastructure/document-store-usage-quota-repository.js";
import type { EntitlementRecord } from "../src/domain/usage-quota-service.js";

class FakeEntitlementCollection {
  readonly documents: Record<string, unknown>[] = [];
  activeResult: unknown | null = null;
  lastFindActive: { deviceId: string; at: string } | null = null;

  async insertOne(document: Record<string, unknown>): Promise<void> {
    this.documents.push(document);
  }

  async findActive(deviceId: string, at: string): Promise<unknown | null> {
    this.lastFindActive = { deviceId, at };
    return structuredClone(this.activeResult);
  }
}

class FakeUsageDailyCollection {
  readonly calls: Array<{ deviceId: string; date: string; limit: number }> = [];
  nextResult = { allowed: true, used: 1 };

  async consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    this.calls.push({ deviceId, date, limit });
    return this.nextResult;
  }
}

describe("DocumentStoreUsageQuotaRepository", () => {
  test("creates and reads active entitlement documents", async () => {
    const entitlements = new FakeEntitlementCollection();
    const usageDaily = new FakeUsageDailyCollection();
    const repository = new DocumentStoreUsageQuotaRepository(entitlements, usageDaily);
    const record: EntitlementRecord = {
      deviceId: "device-1",
      source: "afdian",
      sourceOrderId: "afdian-order-1",
      startsAt: new Date("2026-09-13T00:00:00.000Z"),
      expiresAt: new Date("2026-10-13T00:00:00.000Z"),
      createdAt: new Date("2026-09-13T00:00:01.000Z"),
    };

    await repository.createEntitlement(record);
    expect(entitlements.documents[0]).toEqual({
      device_id: "device-1",
      source: "afdian",
      source_order_id: "afdian-order-1",
      starts_at: "2026-09-13T00:00:00.000Z",
      expires_at: "2026-10-13T00:00:00.000Z",
      created_at: "2026-09-13T00:00:01.000Z",
    });

    entitlements.activeResult = entitlements.documents[0];
    await expect(repository.findActiveEntitlement("device-1", new Date("2026-09-20T00:00:00.000Z"))).resolves.toEqual(record);
    await expect(repository.hasPaidAccess("device-1", new Date("2026-09-20T00:00:00.000Z"))).resolves.toBe(true);
    expect(entitlements.lastFindActive).toEqual({ deviceId: "device-1", at: "2026-09-20T00:00:00.000Z" });
  });

  test("delegates daily consumption to an atomic daily-usage collection", async () => {
    const entitlements = new FakeEntitlementCollection();
    const usageDaily = new FakeUsageDailyCollection();
    usageDaily.nextResult = { allowed: false, used: 30 };
    const repository = new DocumentStoreUsageQuotaRepository(entitlements, usageDaily);

    await expect(repository.consumeDaily("device-2", "2026-09-13", 30)).resolves.toEqual({ allowed: false, used: 30 });
    expect(usageDaily.calls[0]).toEqual({ deviceId: "device-2", date: "2026-09-13", limit: 30 });
  });

  test("returns null for missing or malformed entitlement documents", async () => {
    const entitlements = new FakeEntitlementCollection();
    const usageDaily = new FakeUsageDailyCollection();
    const repository = new DocumentStoreUsageQuotaRepository(entitlements, usageDaily);

    entitlements.activeResult = null;
    await expect(repository.findActiveEntitlement("missing", new Date("2026-09-20T00:00:00.000Z"))).resolves.toBeNull();
    await expect(repository.hasPaidAccess("missing", new Date("2026-09-20T00:00:00.000Z"))).resolves.toBe(false);

    entitlements.activeResult = {
      device_id: "bad",
      source: "afdian",
      source_order_id: "order",
      starts_at: "not-a-date",
      expires_at: "2026-10-13T00:00:00.000Z",
      created_at: "2026-09-13T00:00:01.000Z",
    };
    await expect(repository.findActiveEntitlement("bad", new Date("2026-09-20T00:00:00.000Z"))).resolves.toBeNull();
  });
});
