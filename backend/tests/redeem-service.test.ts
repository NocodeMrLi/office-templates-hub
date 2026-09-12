import { describe, expect, test } from "vitest";

import {
  RedeemCodeError,
  RedeemService,
  type CodeRecord,
  type CodeRepository,
  type SubscriptionGrantService,
} from "../src/domain/redeem-service.js";

class TestCodeRepository implements CodeRepository {
  readonly records = new Map<string, CodeRecord>();

  async findByDigest(codeDigest: string): Promise<CodeRecord | null> {
    return structuredClone(this.records.get(codeDigest) ?? null);
  }

  async markRedeemed(codeDigest: string, deviceId: string, redeemedAt: Date): Promise<boolean> {
    const record = this.records.get(codeDigest);
    if (!record || record.redeemedAt) {
      return false;
    }
    this.records.set(codeDigest, { ...record, redeemedByDeviceId: deviceId, redeemedAt });
    return true;
  }
}

class TestSubscriptionGrantService implements SubscriptionGrantService {
  grantCalls = 0;

  async grantSubscriptionMonth(deviceId: string, sourceOrderId: string) {
    this.grantCalls += 1;
    return {
      deviceId,
      source: "afdian" as const,
      sourceOrderId,
      startsAt: new Date("2026-09-12T02:00:00.000Z"),
      expiresAt: new Date("2026-10-12T02:00:00.000Z"),
      createdAt: new Date("2026-09-12T02:00:00.000Z"),
    };
  }
}

function createService() {
  const repository = new TestCodeRepository();
  const grants = new TestSubscriptionGrantService();
  const service = new RedeemService(repository, grants, "test-code-pepper", () =>
    new Date("2026-09-12T02:00:00.000Z"));
  return { repository, grants, service };
}

describe("RedeemService", () => {
  test("stores and matches only the code digest when redeeming an Afdian subscription code", async () => {
    const { repository, service } = createService();
    const codeDigest = service.digestCodeForImport("AF-ORDER-001-CODE");
    repository.records.set(codeDigest, {
      codeDigest,
      type: "afdian_month",
      status: "active",
      sourceOrderId: "afdian-order-001",
      createdAt: new Date("2026-09-12T01:00:00.000Z"),
    });

    const result = await service.redeem({
      deviceId: "device-1",
      code: "AF-ORDER-001-CODE",
    });

    expect(result).toEqual({
      entitlement: "afdian_month",
      daily_limit: 30,
      expires_at: "2026-10-12T02:00:00.000Z",
    });
    expect(JSON.stringify([...repository.records.values()])).not.toContain("AF-ORDER-001-CODE");
    expect(repository.records.get(codeDigest)).toMatchObject({
      redeemedByDeviceId: "device-1",
      redeemedAt: new Date("2026-09-12T02:00:00.000Z"),
    });
  });

  test("rejects unknown, expired and disabled codes with the same public error", async () => {
    const { repository, service } = createService();
    const expiredDigest = service.digestCodeForImport("EXPIRED-CODE");
    const disabledDigest = service.digestCodeForImport("DISABLED-CODE");
    repository.records.set(expiredDigest, {
      codeDigest: expiredDigest,
      type: "afdian_month",
      status: "active",
      sourceOrderId: "expired-order",
      expiresAt: new Date("2026-09-11T02:00:00.000Z"),
      createdAt: new Date("2026-09-10T02:00:00.000Z"),
    });
    repository.records.set(disabledDigest, {
      codeDigest: disabledDigest,
      type: "afdian_month",
      status: "disabled",
      sourceOrderId: "disabled-order",
      createdAt: new Date("2026-09-10T02:00:00.000Z"),
    });

    await expect(service.redeem({ deviceId: "device-1", code: "UNKNOWN-CODE" })).rejects.toEqual(
      new RedeemCodeError(),
    );
    await expect(service.redeem({ deviceId: "device-1", code: "EXPIRED-CODE" })).rejects.toEqual(
      new RedeemCodeError(),
    );
    await expect(service.redeem({ deviceId: "device-1", code: "DISABLED-CODE" })).rejects.toEqual(
      new RedeemCodeError(),
    );
  });

  test("allows only one concurrent redemption for the same code", async () => {
    const { repository, grants, service } = createService();
    const codeDigest = service.digestCodeForImport("AF-CONCURRENT-CODE");
    repository.records.set(codeDigest, {
      codeDigest,
      type: "afdian_month",
      status: "active",
      sourceOrderId: "afdian-order-concurrent",
      createdAt: new Date("2026-09-12T01:00:00.000Z"),
    });

    const results = await Promise.allSettled(
      Array.from({ length: 20 }, () =>
        service.redeem({ deviceId: "device-1", code: "AF-CONCURRENT-CODE" })),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(19);
    expect(grants.grantCalls).toBe(1);
  });
});
