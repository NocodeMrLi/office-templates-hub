import { describe, expect, test } from "vitest";

import { DocumentStoreDeviceRepository } from "../src/infrastructure/document-store-device-repository.js";
import type { DeviceRecord } from "../src/domain/device-service.js";

class FakeDeviceCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly inserts: Record<string, unknown>[] = [];
  readonly updates: Array<{ filter: Record<string, unknown>; patch: Record<string, unknown> }> = [];

  async insertOne(document: Record<string, unknown>): Promise<void> {
    this.inserts.push(document);
    this.documents.set(String(document.device_id), { ...document });
  }

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    return structuredClone(this.documents.get(String(filter.device_id)) ?? null);
  }

  async updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }> {
    this.updates.push({ filter, patch });
    const current = this.documents.get(String(filter.device_id));
    if (!current) return { modifiedCount: 0 };
    this.documents.set(String(filter.device_id), { ...current, ...patch });
    return { modifiedCount: 1 };
  }
}

describe("DocumentStoreDeviceRepository", () => {
  test("stores and reads device records using database field names", async () => {
    const collection = new FakeDeviceCollection();
    const repository = new DocumentStoreDeviceRepository(collection);
    const record: DeviceRecord = {
      deviceId: "device-1",
      secretDigest: "secret-digest",
      status: "active",
      createdAt: new Date("2026-09-13T00:00:00.000Z"),
    };

    await repository.create(record);

    expect(collection.inserts[0]).toEqual({
      device_id: "device-1",
      secret_digest: "secret-digest",
      status: "active",
      created_at: "2026-09-13T00:00:00.000Z",
    });
    await expect(repository.findById("device-1")).resolves.toEqual(record);
  });

  test("updates a device secret and rotation timestamp", async () => {
    const collection = new FakeDeviceCollection();
    collection.documents.set("device-2", {
      device_id: "device-2",
      secret_digest: "old-digest",
      status: "active",
      created_at: "2026-09-13T00:00:00.000Z",
    });
    const repository = new DocumentStoreDeviceRepository(collection);
    const rotatedAt = new Date("2026-09-14T00:00:00.000Z");

    await repository.replaceSecret("device-2", "new-digest", rotatedAt);

    expect(collection.updates[0]).toEqual({
      filter: { device_id: "device-2" },
      patch: { secret_digest: "new-digest", rotated_at: rotatedAt.toISOString() },
    });
    await expect(repository.findById("device-2")).resolves.toMatchObject({
      deviceId: "device-2",
      secretDigest: "new-digest",
      rotatedAt,
    });
  });

  test("returns null for missing or malformed device documents", async () => {
    const collection = new FakeDeviceCollection();
    collection.documents.set("bad", {
      device_id: "bad",
      secret_digest: "digest",
      status: "unknown",
      created_at: "2026-09-13T00:00:00.000Z",
    });
    const repository = new DocumentStoreDeviceRepository(collection);

    await expect(repository.findById("missing")).resolves.toBeNull();
    await expect(repository.findById("bad")).resolves.toBeNull();
  });
});
