import { describe, expect, test } from "vitest";

import { createInMemoryRuntimeRepositories } from "../src/runtime-app.js";
import type { RuntimeEntitlementRepository } from "../src/runtime-app.js";
import type { EntitlementRecord } from "../src/domain/usage-quota-service.js";

class AlwaysFreeEntitlementRepository implements RuntimeEntitlementRepository {
  async hasPaidAccess(): Promise<boolean> {
    return false;
  }

  async findActiveEntitlement(): Promise<EntitlementRecord | null> {
    return null;
  }
}

describe("runtime repository contract", () => {
  test("accepts entitlement repositories that are not the in-memory implementation", async () => {
    const repositories = createInMemoryRuntimeRepositories();
    repositories.entitlements = new AlwaysFreeEntitlementRepository();

    await expect(repositories.entitlements.hasPaidAccess("device-1", new Date("2026-09-13T00:00:00.000Z")))
      .resolves.toBe(false);
  });
});
