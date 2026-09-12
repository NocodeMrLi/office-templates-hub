import { describe, expect, test } from "vitest";

import {
  DeviceAuthError,
  DeviceService,
  type DeviceRecord,
  type DeviceRepository,
} from "../src/domain/device-service.js";

class TestDeviceRepository implements DeviceRepository {
  readonly records = new Map<string, DeviceRecord>();

  async create(record: DeviceRecord): Promise<void> {
    this.records.set(record.deviceId, structuredClone(record));
  }

  async findById(deviceId: string): Promise<DeviceRecord | null> {
    return structuredClone(this.records.get(deviceId) ?? null);
  }

  async replaceSecret(deviceId: string, secretDigest: string, rotatedAt: Date): Promise<void> {
    const current = this.records.get(deviceId);
    if (!current) throw new Error("device missing");
    this.records.set(deviceId, { ...current, secretDigest, rotatedAt });
  }

  disable(deviceId: string): void {
    const current = this.records.get(deviceId);
    if (!current) throw new Error("device missing");
    this.records.set(deviceId, { ...current, status: "disabled" });
  }
}

describe("DeviceService", () => {
  test("registers a device while persisting only the secret digest", async () => {
    const repository = new TestDeviceRepository();
    const service = new DeviceService(repository, "test-device-pepper");

    const credentials = await service.register();
    const stored = repository.records.get(credentials.deviceId);

    expect(credentials.deviceSecret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(stored?.secretDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(credentials.deviceSecret);
    await expect(service.authenticate(credentials.deviceId, credentials.deviceSecret)).resolves.toMatchObject({
      deviceId: credentials.deviceId,
      status: "active",
    });
  });

  test("rejects a wrong secret and a disabled device with the same public error", async () => {
    const repository = new TestDeviceRepository();
    const service = new DeviceService(repository, "test-device-pepper");
    const credentials = await service.register();

    await expect(service.authenticate(credentials.deviceId, "wrong-secret")).rejects.toMatchObject({
      code: "UNAUTHORIZED_DEVICE",
    });

    repository.disable(credentials.deviceId);
    await expect(service.authenticate(credentials.deviceId, credentials.deviceSecret)).rejects.toEqual(
      new DeviceAuthError(),
    );
  });

  test("rotates the secret and immediately invalidates the old value", async () => {
    const repository = new TestDeviceRepository();
    const service = new DeviceService(repository, "test-device-pepper");
    const original = await service.register();

    const rotated = await service.rotateSecret(original.deviceId, original.deviceSecret);

    expect(rotated.deviceSecret).not.toBe(original.deviceSecret);
    await expect(service.authenticate(original.deviceId, original.deviceSecret)).rejects.toMatchObject({
      code: "UNAUTHORIZED_DEVICE",
    });
    await expect(service.authenticate(rotated.deviceId, rotated.deviceSecret)).resolves.toMatchObject({
      deviceId: original.deviceId,
      status: "active",
    });
  });
});
