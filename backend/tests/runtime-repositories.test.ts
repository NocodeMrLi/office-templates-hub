import { describe, expect, test } from "vitest";

import { createRuntimeApp, createInMemoryRuntimeRepositories } from "../src/runtime-app.js";
import type { DeviceRecord, DeviceRepository } from "../src/domain/device-service.js";

class CountingDeviceRepository implements DeviceRepository {
  createCalls = 0;
  readonly records = new Map<string, DeviceRecord>();

  async create(record: DeviceRecord): Promise<void> {
    this.createCalls += 1;
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
}

describe("runtime repository injection", () => {
  test("uses injected repositories and reports their health", async () => {
    const repositories = createInMemoryRuntimeRepositories();
    const devices = new CountingDeviceRepository();
    repositories.devices = devices;
    repositories.health = async () => "ok";

    const app = await createRuntimeApp({
      devicePepper: "device-pepper",
      codePepper: "code-pepper",
      recoveryPepper: "recovery-pepper",
      repositories,
    });

    const registerResponse = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "repo-injection-register" },
    });
    expect(registerResponse.statusCode).toBe(201);
    expect(devices.createCalls).toBe(1);

    const healthResponse = await app.inject({ method: "GET", url: "/api/health" });
    expect(healthResponse.json()).toMatchObject({
      dependencies: {
        database: "ok",
      },
    });
  });
});
