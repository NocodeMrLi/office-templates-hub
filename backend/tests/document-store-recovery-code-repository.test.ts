import { describe, expect, test } from "vitest";

import { DocumentStoreRecoveryCodeRepository } from "../src/infrastructure/document-store-recovery-code-repository.js";
import type { RecoveryCodeRecord } from "../src/domain/recovery-service.js";

class FakeRecoveryCollection {
  readonly documents = new Map<string, Record<string, unknown>>();
  readonly inserts: Record<string, unknown>[] = [];
  readonly updates: Array<{ filter: Record<string, unknown>; patch: Record<string, unknown> }> = [];

  async insertOne(document: Record<string, unknown>): Promise<void> {
    this.inserts.push(document);
    this.documents.set(String(document.recovery_digest), { ...document });
  }

  async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
    return structuredClone(this.documents.get(String(filter.recovery_digest)) ?? null);
  }

  async updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }> {
    this.updates.push({ filter, patch });
    const current = this.documents.get(String(filter.recovery_digest));
    if (!current || current.used_at !== filter.used_at) return { modifiedCount: 0 };
    this.documents.set(String(filter.recovery_digest), { ...current, ...patch });
    return { modifiedCount: 1 };
  }
}

describe("DocumentStoreRecoveryCodeRepository", () => {
  test("creates and reads recovery code documents", async () => {
    const collection = new FakeRecoveryCollection();
    const repository = new DocumentStoreRecoveryCodeRepository(collection);
    const record: RecoveryCodeRecord = {
      recoveryDigest: "recovery-digest-1",
      deviceId: "device-1",
      status: "active",
      createdAt: new Date("2026-09-13T00:00:00.000Z"),
      expiresAt: new Date("2026-10-13T00:00:00.000Z"),
    };

    await repository.create(record);

    expect(collection.inserts[0]).toEqual({
      recovery_digest: "recovery-digest-1",
      device_id: "device-1",
      status: "active",
      created_at: "2026-09-13T00:00:00.000Z",
      expires_at: "2026-10-13T00:00:00.000Z",
    });
    await expect(repository.findByDigest("recovery-digest-1")).resolves.toEqual(record);
  });

  test("marks a recovery code used only once", async () => {
    const collection = new FakeRecoveryCollection();
    collection.documents.set("recovery-digest-2", {
      recovery_digest: "recovery-digest-2",
      device_id: "device-2",
      status: "active",
      created_at: "2026-09-13T00:00:00.000Z",
      used_at: null,
    });
    const repository = new DocumentStoreRecoveryCodeRepository(collection);
    const usedAt = new Date("2026-09-15T00:00:00.000Z");

    await expect(repository.markUsed("recovery-digest-2", usedAt)).resolves.toBe(true);
    await expect(repository.markUsed("recovery-digest-2", usedAt)).resolves.toBe(false);
    expect(collection.updates[0]).toEqual({
      filter: { recovery_digest: "recovery-digest-2", used_at: null },
      patch: { used_at: usedAt.toISOString() },
    });
  });

  test("returns null for missing or malformed recovery code documents", async () => {
    const collection = new FakeRecoveryCollection();
    collection.documents.set("bad", {
      recovery_digest: "bad",
      device_id: "device-3",
      status: "unknown",
      created_at: "2026-09-13T00:00:00.000Z",
    });
    const repository = new DocumentStoreRecoveryCodeRepository(collection);

    await expect(repository.findByDigest("missing")).resolves.toBeNull();
    await expect(repository.findByDigest("bad")).resolves.toBeNull();
  });
});
