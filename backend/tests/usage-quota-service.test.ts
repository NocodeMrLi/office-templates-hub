import { describe, expect, test } from "vitest";

import {
  UsageQuotaService,
  type EntitlementRecord,
  type UsageQuotaRepository,
} from "../src/domain/usage-quota-service.js";

class TestUsageQuotaRepository implements UsageQuotaRepository {
  readonly entitlements: EntitlementRecord[] = [];
  readonly usage = new Map<string, number>();

  async createEntitlement(record: EntitlementRecord): Promise<void> {
    this.entitlements.push(structuredClone(record));
  }

  async findActiveEntitlement(deviceId: string, at: Date): Promise<EntitlementRecord | null> {
    return this.entitlements.find((record) =>
      record.deviceId === deviceId
      && record.startsAt.getTime() <= at.getTime()
      && record.expiresAt.getTime() > at.getTime()
    ) ?? null;
  }

  async consumeDaily(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const key = `${deviceId}:${date}`;
    const current = this.usage.get(key) ?? 0;
    if (current >= limit) {
      return { allowed: false, used: current };
    }
    const next = current + 1;
    this.usage.set(key, next);
    return { allowed: true, used: next };
  }
}

describe("UsageQuotaService", () => {
  test("allows five free calls per China calendar day and rejects the sixth", async () => {
    const repository = new TestUsageQuotaRepository();
    const service = new UsageQuotaService(repository, () => new Date("2026-09-12T10:00:00+08:00"));

    const results = await Promise.all(Array.from({ length: 6 }, () => service.authorizeCall("device-free")));

    expect(results.map((result) => result.allowed)).toEqual([true, true, true, true, true, false]);
    expect(results.at(-1)).toMatchObject({ tier: "free", limit: 5, used: 5 });
  });

  test("uses the paid limit during the one-month subscription window and falls back after expiry", async () => {
    const repository = new TestUsageQuotaRepository();
    let now = new Date("2026-09-12T10:00:00+08:00");
    const service = new UsageQuotaService(repository, () => now);

    const grant = await service.grantSubscriptionMonth("device-paid", "afdian-order-001");
    const paidResults = await Promise.all(Array.from({ length: 31 }, () => service.authorizeCall("device-paid")));

    expect(grant.expiresAt.toISOString()).toBe("2026-10-12T02:00:00.000Z");
    expect(paidResults.filter((result) => result.allowed)).toHaveLength(30);
    expect(paidResults.at(-1)).toMatchObject({ allowed: false, tier: "paid", limit: 30, used: 30 });

    now = new Date("2026-10-13T10:00:00+08:00");
    const expiredResults = await Promise.all(Array.from({ length: 6 }, () => service.authorizeCall("device-paid")));

    expect(expiredResults.map((result) => result.allowed)).toEqual([true, true, true, true, true, false]);
    expect(expiredResults.at(-1)).toMatchObject({ tier: "free", limit: 5, used: 5 });
  });

  test("resets daily usage at the China calendar-day boundary", async () => {
    const repository = new TestUsageQuotaRepository();
    let now = new Date("2026-09-12T23:50:00+08:00");
    const service = new UsageQuotaService(repository, () => now);

    await Promise.all(Array.from({ length: 5 }, () => service.authorizeCall("device-boundary")));
    const blocked = await service.authorizeCall("device-boundary");
    now = new Date("2026-09-13T00:10:00+08:00");
    const reset = await service.authorizeCall("device-boundary");

    expect(blocked).toMatchObject({ allowed: false, used: 5, day: "2026-09-12" });
    expect(reset).toMatchObject({ allowed: true, used: 1, day: "2026-09-13" });
  });
});
