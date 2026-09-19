import { describe, expect, test } from "vitest";

import {
  DocumentStoreCodeRepository,
} from "../src/infrastructure/document-store-code-repository.js";
import {
  DocumentStoreDeviceRepository,
} from "../src/infrastructure/document-store-device-repository.js";
import {
  DocumentStoreDownloadEventRepository,
} from "../src/infrastructure/document-store-download-event-repository.js";
import {
  DocumentStoreRecoveryCodeRepository,
} from "../src/infrastructure/document-store-recovery-code-repository.js";
import {
  DocumentStoreRegistrationResultStore,
  type DocumentStoreRegistrationResultCollection,
} from "../src/infrastructure/document-store-registration-result-store.js";
import {
  DocumentStoreUsageQuotaRepository,
} from "../src/infrastructure/document-store-usage-quota-repository.js";
import { DocumentStoreDownloadTemplateRepository } from "../src/infrastructure/document-store-template-repository.js";
import { adaptCloudBaseCollection } from "../src/infrastructure/document-store-cloudbase-adapter.js";

type AnyRecord = Record<string, unknown>;

interface CloudBaseLikeCollection {
  doc(id: string): { get(): Promise<{ data: unknown }>; set(data: AnyRecord): Promise<{ updated: number }> };
  add(data: AnyRecord): Promise<{ id: string }>;
  where(filter: AnyRecord): {
    get(): Promise<{ data: unknown[] }>;
    update(patch: AnyRecord): Promise<{ updated: number }>;
    limit(n: number): {
      get(): Promise<{ data: unknown[] }>;
      update(patch: AnyRecord): Promise<{ updated: number }>;
    };
  };
}

class CloudBaseStubCollection implements CloudBaseLikeCollection {
  result: unknown = null;
  calls: Array<{ op: string; args: unknown[] }> = [];

  doc(id: string) {
    this.calls.push({ op: "doc", args: [id] });
    return {
      get: async () => {
        this.calls.push({ op: "doc.get", args: [id] });
        return { data: this.result };
      },
      set: async (data: AnyRecord) => {
        this.calls.push({ op: "doc.set", args: [id, data] });
        return { updated: 1 };
      },
    };
  }

  async add(data: AnyRecord) {
    this.calls.push({ op: "add", args: [data] });
    return { id: "generated-id" };
  }

  where(filter: AnyRecord) {
    this.calls.push({ op: "where", args: [filter] });
    return {
      get: async () => {
        this.calls.push({ op: "where.get", args: [filter] });
        return { data: this.result ? [this.result] : [] };
      },
      update: async (patch: AnyRecord) => {
        this.calls.push({ op: "where.update", args: [filter, patch] });
        return { updated: 1 };
      },
      limit: (n: number) => ({
        get: async () => {
          this.calls.push({ op: "where.limit.get", args: [filter, n] });
          return { data: this.result ? [this.result] : [] };
        },
        update: async (patch: AnyRecord) => {
          this.calls.push({ op: "where.limit.update", args: [filter, n, patch] });
          if (isRecord(this.result)) {
            for (const [key, value] of Object.entries(patch)) {
              if (isRecord(value) && typeof value.$inc === "number") {
                const current = this.result[key];
                this.result[key] = (typeof current === "number" ? current : 0) + value.$inc;
              } else {
                this.result[key] = value;
              }
            }
          }
          return { updated: 1 };
        },
      }),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function makeAdapter<T>(cls: new (collection: never) => T): { adapter: T; stub: CloudBaseStubCollection } {
  const stub = new CloudBaseStubCollection();
  return { adapter: new cls(adaptCloudBaseCollection(stub, { command: cloudBaseCommand }) as never), stub };
}

const cloudBaseCommand = {
  gt: (value: unknown) => ({ $gt: value }),
  lte: (value: unknown) => ({ $lte: value }),
  lt: (value: unknown) => ({ $lt: value }),
  inc: (value: number) => ({ $inc: value }),
};

describe("document store adapters against CloudBase-shaped SDK", () => {
  test("template repository uses doc.get and maps the active template", async () => {
    const { adapter, stub } = makeAdapter(DocumentStoreDownloadTemplateRepository as never);
    stub.result = {
      public_id: "tpl_x",
      access_tier: "free",
      object_key: "templates/tpl_x.xlsx",
      object_sha256: "a".repeat(64),
      status: "active",
    };
    const template = await (adapter as InstanceType<typeof DocumentStoreDownloadTemplateRepository>).findByPublicId("tpl_x");
    expect(template).toMatchObject({ publicId: "tpl_x", objectKey: "templates/tpl_x.xlsx" });
    expect(stub.calls[0]?.op).toBe("where");
  });

  test("device repository reads a device by id", async () => {
    const { adapter, stub } = makeAdapter(DocumentStoreDeviceRepository as never);
    stub.result = {
      device_id: "device-1",
      secret_digest: "digest",
      status: "active",
      created_at: "2026-09-13T00:00:00.000Z",
      rotated_at: null,
    };
    const record = await (adapter as InstanceType<typeof DocumentStoreDeviceRepository>).findById("device-1");
    expect(record).toMatchObject({ deviceId: "device-1", secretDigest: "digest" });
    expect(stub.calls[0]?.op).toBe("where");
  });

  test("code repository maps an import document and marks redeemed via conditional update", async () => {
    const { adapter, stub } = makeAdapter(DocumentStoreCodeRepository as never);
    stub.result = {
      code_digest: "digest-1",
      type: "afdian_month",
      status: "active",
      source_order_id: "order-1",
      created_at: "2026-09-13T00:00:00.000Z",
      redeemed_by_device_id: null,
      redeemed_at: null,
    };
    const repo = adapter as InstanceType<typeof DocumentStoreCodeRepository>;
    const record = await repo.findByDigest("digest-1");
    expect(record).toMatchObject({ codeDigest: "digest-1", sourceOrderId: "order-1" });

    stub.calls = [];
    const redeemed = await repo.markRedeemed("digest-1", "device-1", new Date("2026-09-13T01:00:00.000Z"));
    expect(redeemed).toBe(true);
    expect(stub.calls.at(-1)).toMatchObject({
      op: "where.limit.update",
      args: [
        { code_digest: "digest-1", redeemed_at: null },
        1,
        { redeemed_by_device_id: "device-1", redeemed_at: "2026-09-13T01:00:00.000Z" },
      ],
    });
  });

  test("recovery repository maps an import document and marks used once", async () => {
    const { adapter, stub } = makeAdapter(DocumentStoreRecoveryCodeRepository as never);
    stub.result = {
      recovery_digest: "recovery-1",
      device_id: "device-1",
      status: "active",
      created_at: "2026-09-13T00:00:00.000Z",
      expires_at: null,
      used_at: null,
    };
    const repo = adapter as InstanceType<typeof DocumentStoreRecoveryCodeRepository>;
    const record = await repo.findByDigest("recovery-1");
    expect(record).toMatchObject({ recoveryDigest: "recovery-1", deviceId: "device-1" });
    const used = await repo.markUsed("recovery-1", new Date("2026-09-13T01:00:00.000Z"));
    expect(used).toBe(true);
  });

  test("download event repository reads an existing event", async () => {
    const { adapter, stub } = makeAdapter(DocumentStoreDownloadEventRepository as never);
    stub.result = {
      device_id: "device-1",
      idempotency_key: "key-1",
      public_id: "tpl_x",
      state: "delivered",
      created_at: "2026-09-13T00:00:00.000Z",
      updated_at: "2026-09-13T00:01:00.000Z",
      reservation_id: "reservation-1",
      result: {
        public_id: "tpl_x",
        download_url: "https://signed.example/x",
        expires_at: "2026-09-13T00:05:00.000Z",
        sha256: "a".repeat(64),
        quota_remaining: null,
        quota_applied: false,
      },
    };
    const repo = adapter as InstanceType<typeof DocumentStoreDownloadEventRepository>;
    const event = await repo.findByDeviceAndKey("device-1", "key-1");
    expect(event).toMatchObject({ deviceId: "device-1", idempotencyKey: "key-1", state: "delivered" });
    expect(event?.result).toMatchObject({ public_id: "tpl_x" });
  });

  test("entitlement/usage repository reads active entitlement and delegates consumption", async () => {
    const entitlementStub = new CloudBaseStubCollection();
    const usageDailyStub = new CloudBaseStubCollection();
    const adapter = new DocumentStoreUsageQuotaRepository(
      adaptCloudBaseCollection(entitlementStub, { command: cloudBaseCommand }) as never,
      adaptCloudBaseCollection(usageDailyStub, {
        command: cloudBaseCommand,
        now: () => new Date("2026-09-13T01:00:00.000Z"),
      }) as never,
    );
    entitlementStub.result = {
      device_id: "device-1",
      source: "afdian",
      source_order_id: "order-1",
      starts_at: "2026-09-13T00:00:00.000Z",
      expires_at: "2026-10-13T00:00:00.000Z",
      created_at: "2026-09-13T00:00:00.000Z",
    };
    const repo = adapter as InstanceType<typeof DocumentStoreUsageQuotaRepository>;
    const entitlement = await repo.findActiveEntitlement("device-1", new Date("2026-09-20T00:00:00.000Z"));
    expect(entitlement).toMatchObject({ deviceId: "device-1", source: "afdian" });
    expect(entitlementStub.calls.at(-1)).toEqual({
      op: "where.limit.get",
      args: [
        {
          device_id: "device-1",
          status: "active",
          starts_at: { $lte: "2026-09-20T00:00:00.000Z" },
          expires_at: { $gt: "2026-09-20T00:00:00.000Z" },
        },
        1,
      ],
    });
    usageDailyStub.result = { device_id: "device-1", date: "2026-09-13", used: 1 };
    const consumption = await repo.consumeDaily("device-1", "2026-09-13", 5);
    expect(consumption).toEqual({ allowed: true, used: 2 });
    expect(usageDailyStub.calls.map((call) => call.op)).toEqual([
      "where",
      "where.limit.get",
      "where",
      "where.limit.update",
      "where",
      "where.limit.get",
    ]);
    expect(usageDailyStub.calls[3]).toEqual({
      op: "where.limit.update",
      args: [
        { device_id: "device-1", date: "2026-09-13", used: { $lt: 5 } },
        1,
        { limit: 5, used: { $inc: 1 }, updated_at: "2026-09-13T01:00:00.000Z" },
      ],
    });
  });

  test("registration result store reuses an existing CloudBase document", async () => {
    const stub = new CloudBaseStubCollection();
    stub.result = { idempotency_key: "key-1", device_id: "device-1", device_secret: "secret-1" };
    const store = new DocumentStoreRegistrationResultStore(
      adaptCloudBaseCollection(stub) as unknown as DocumentStoreRegistrationResultCollection,
    );
    let createCalls = 0;
    const result = await store.getOrCreate("key-1", async () => {
      createCalls += 1;
      return { deviceId: "device-new", deviceSecret: "secret-new" };
    });
    expect(result).toEqual({ deviceId: "device-1", deviceSecret: "secret-1" });
    expect(createCalls).toBe(0);
  });
});
