import { describe, expect, test } from "vitest";

import {
  createRuntimeRepositoriesForCloudBase,
  type CloudBaseDatabase,
} from "../src/runtime-app.js";

interface RecordingCollection {
  readonly name: string;
  readonly calls: Array<{ op: string; args: unknown[] }>;
  result?: unknown;
}

class FakeCloudBaseDatabase implements CloudBaseDatabase {
  readonly collections = new Map<string, RecordingCollection>();
  readonly command = {
    inc: (value: number) => ({ $inc: value }),
  };

  collection(name: string): unknown {
    if (!this.collections.has(name)) {
      this.collections.set(name, { name, calls: [] });
    }
    const record = this.collections.get(name)!;
    return {
      doc: (id: string) => ({
        get: async () => {
          record.calls.push({ op: "doc.get", args: [id] });
          return { data: record.result ?? null };
        },
        set: async (data: unknown) => {
          record.calls.push({ op: "doc.set", args: [data] });
          return { updated: 1 };
        },
      }),
      add: async (data: unknown) => {
        record.calls.push({ op: "add", args: [data] });
        return { id: "generated-id" };
      },
      where: (filter: unknown) => ({
        get: async () => {
          record.calls.push({ op: "where.get", args: [filter] });
          return { data: record.result ? [record.result] : [] };
        },
        limit: (n: number) => ({
          update: async (patch: unknown) => {
            record.calls.push({ op: "where.limit.update", args: [filter, n, patch] });
            return { updated: 1 };
          },
        }),
        update: async (patch: unknown) => {
          record.calls.push({ op: "where.update", args: [filter, patch] });
          return { updated: 1 };
        },
      }),
      findActive: async (deviceId: string, at: string) => {
        record.calls.push({ op: "findActive", args: [deviceId, at] });
        return record.result ?? null;
      },
      consumeOne: async (deviceId: string, date: string, limit: number) => {
        record.calls.push({ op: "consumeOne", args: [deviceId, date, limit] });
        return { allowed: true, used: 1 };
      },
      findOne: async (filter: unknown) => {
        record.calls.push({ op: "findOne", args: [filter] });
        return record.result ?? null;
      },
      insertIfAbsent: async (document: unknown) => {
        record.calls.push({ op: "insertIfAbsent", args: [document] });
        return { inserted: true };
      },
    };
  }
}

describe("CloudBase runtime repository adapter", () => {
  test("builds one repository per CloudBase collection", async () => {
    const db = new FakeCloudBaseDatabase();
    const repositories = createRuntimeRepositoriesForCloudBase(db);

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
    expect([...db.collections.keys()].sort()).toEqual([
      "codes",
      "devices",
      "download_events",
      "entitlements",
      "recovery_codes",
      "registration_results",
      "templates",
      "usage_daily",
    ]);
    await expect(repositories.health()).resolves.toBe("ok");
  });

  test("delegates device registration through the document store", async () => {
    const db = new FakeCloudBaseDatabase();
    const repositories = createRuntimeRepositoriesForCloudBase(db);
    let createCalls = 0;

    const result = await repositories.registrationResults.getOrCreate("register-key-1", async () => {
      createCalls += 1;
      return { deviceId: "device-1", deviceSecret: "secret-1" };
    });

    expect(result).toEqual({ deviceId: "device-1", deviceSecret: "secret-1" });
    expect(createCalls).toBe(1);
    expect(db.collections.get("registration_results")!.calls.map((call) => call.op)).toEqual(["findOne", "insertIfAbsent"]);
    expect(db.collections.get("registration_results")!.calls[1]).toEqual({
      op: "insertIfAbsent",
      args: [{ idempotency_key: "register-key-1", device_id: "device-1", device_secret: "secret-1" }],
    });
  });
});
