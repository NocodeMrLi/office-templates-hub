import { describe, expect, test } from "vitest";

import { DocumentStoreDownloadEventRepository } from "../src/infrastructure/document-store-download-event-repository.js";
import type { DownloadEvent } from "../src/domain/download-service.js";

class FakeDownloadEventCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly inserts: Record<string, unknown>[] = [];
  readonly updates: Array<{ filter: Record<string, unknown>; patch: Record<string, unknown> }> = [];

  async insertOne(document: Record<string, unknown>): Promise<void> {
    this.inserts.push(document);
    this.documents.set(`${document.device_id}:${document.idempotency_key}`, { ...document });
  }

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    return structuredClone(this.documents.get(`${filter.device_id}:${filter.idempotency_key}`) ?? null);
  }

  async updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }> {
    this.updates.push({ filter, patch });
    const key = `${filter.device_id}:${filter.idempotency_key}`;
    const current = this.documents.get(key);
    if (!current) return { modifiedCount: 0 };
    this.documents.set(key, { ...current, ...patch });
    return { modifiedCount: 1 };
  }
}

const deliveredEvent: DownloadEvent = {
  deviceId: "device-1",
  idempotencyKey: "download-key-1",
  publicId: "tpl_001",
  state: "delivered",
  createdAt: new Date("2026-09-13T00:00:00.000Z"),
  updatedAt: new Date("2026-09-13T00:00:03.000Z"),
  reservationId: "reservation-1",
  result: {
    public_id: "tpl_001",
    download_url: "https://example.test/signed",
    expires_at: "2026-09-13T00:05:00.000Z",
    sha256: "a".repeat(64),
    quota_remaining: 4,
  },
};

describe("DocumentStoreDownloadEventRepository", () => {
  test("creates, reads, and saves download events", async () => {
    const collection = new FakeDownloadEventCollection();
    const repository = new DocumentStoreDownloadEventRepository(collection);

    await repository.create(deliveredEvent);

    expect(collection.inserts[0]).toEqual({
      device_id: "device-1",
      idempotency_key: "download-key-1",
      public_id: "tpl_001",
      state: "delivered",
      created_at: "2026-09-13T00:00:00.000Z",
      updated_at: "2026-09-13T00:00:03.000Z",
      reservation_id: "reservation-1",
      result: deliveredEvent.result,
    });
    await expect(repository.findByDeviceAndKey("device-1", "download-key-1")).resolves.toEqual(deliveredEvent);

    const releasedEvent: DownloadEvent = {
      deviceId: deliveredEvent.deviceId,
      idempotencyKey: deliveredEvent.idempotencyKey,
      publicId: deliveredEvent.publicId,
      createdAt: deliveredEvent.createdAt,
      ...(deliveredEvent.reservationId ? { reservationId: deliveredEvent.reservationId } : {}),
      state: "released",
      updatedAt: new Date("2026-09-13T00:00:04.000Z"),
    };
    await repository.save(releasedEvent);

    expect(collection.updates[0]).toEqual({
      filter: { device_id: "device-1", idempotency_key: "download-key-1" },
      patch: {
        public_id: "tpl_001",
        state: "released",
        created_at: "2026-09-13T00:00:00.000Z",
        updated_at: "2026-09-13T00:00:04.000Z",
        reservation_id: "reservation-1",
        result: null,
      },
    });
    await expect(repository.findByDeviceAndKey("device-1", "download-key-1")).resolves.toEqual(releasedEvent);
  });

  test("returns null for missing or malformed download event documents", async () => {
    const collection = new FakeDownloadEventCollection();
    collection.documents.set("device-2:bad", {
      device_id: "device-2",
      idempotency_key: "bad",
      public_id: "tpl_002",
      state: "unknown",
      created_at: "2026-09-13T00:00:00.000Z",
      updated_at: "2026-09-13T00:00:00.000Z",
    });
    const repository = new DocumentStoreDownloadEventRepository(collection);

    await expect(repository.findByDeviceAndKey("device-2", "missing")).resolves.toBeNull();
    await expect(repository.findByDeviceAndKey("device-2", "bad")).resolves.toBeNull();
  });
});
