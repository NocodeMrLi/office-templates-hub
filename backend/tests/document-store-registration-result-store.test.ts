import { describe, expect, test } from "vitest";

import { DocumentStoreRegistrationResultStore } from "../src/infrastructure/document-store-registration-result-store.js";

class FakeRegistrationCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly insertAttempts: Record<string, unknown>[] = [];

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    return structuredClone(this.documents.get(String(filter.idempotency_key)) ?? null);
  }

  async insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }> {
    this.insertAttempts.push(document);
    const key = String(document.idempotency_key);
    if (this.documents.has(key)) return { inserted: false };
    this.documents.set(key, { ...document });
    return { inserted: true };
  }
}

describe("DocumentStoreRegistrationResultStore", () => {
  test("creates and reuses registration results by idempotency key", async () => {
    const collection = new FakeRegistrationCollection();
    const store = new DocumentStoreRegistrationResultStore(collection);
    let createCalls = 0;
    const create = async () => {
      createCalls += 1;
      return { deviceId: "device-1", deviceSecret: "secret-1" };
    };

    await expect(store.getOrCreate("register-key-1", create)).resolves.toEqual({
      deviceId: "device-1",
      deviceSecret: "secret-1",
    });
    await expect(store.getOrCreate("register-key-1", create)).resolves.toEqual({
      deviceId: "device-1",
      deviceSecret: "secret-1",
    });

    expect(createCalls).toBe(1);
    expect(collection.insertAttempts[0]).toEqual({
      idempotency_key: "register-key-1",
      device_id: "device-1",
      device_secret: "secret-1",
    });
  });

  test("returns existing result if another caller inserted first", async () => {
    const collection = new FakeRegistrationCollection();
    collection.documents.set("register-key-2", {
      idempotency_key: "register-key-2",
      device_id: "device-existing",
      device_secret: "secret-existing",
    });
    const store = new DocumentStoreRegistrationResultStore(collection);

    await expect(store.getOrCreate("register-key-2", async () => ({
      deviceId: "device-new",
      deviceSecret: "secret-new",
    }))).resolves.toEqual({
      deviceId: "device-existing",
      deviceSecret: "secret-existing",
    });
  });

  test("throws if a concurrent insert wins but the stored document is unreadable", async () => {
    const collection = new FakeRegistrationCollection();
    const store = new DocumentStoreRegistrationResultStore(collection);
    collection.insertIfAbsent = async () => ({ inserted: false });

    await expect(store.getOrCreate("missing-after-conflict", async () => ({
      deviceId: "device-3",
      deviceSecret: "secret-3",
    }))).rejects.toThrow("registration result missing after conflict");
  });
});
