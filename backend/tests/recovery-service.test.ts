import { describe, expect, test } from "vitest";

import { DeviceService, type DeviceRecord, type DeviceRepository } from "../src/domain/device-service.js";
import {
  RecoveryCodeError,
  RecoveryService,
  type RecoveryCodeRecord,
  type RecoveryCodeRepository,
} from "../src/domain/recovery-service.js";

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
}

class TestRecoveryCodeRepository implements RecoveryCodeRepository {
  readonly records = new Map<string, RecoveryCodeRecord>();

  async findByDigest(recoveryDigest: string): Promise<RecoveryCodeRecord | null> {
    return structuredClone(this.records.get(recoveryDigest) ?? null);
  }

  async markUsed(recoveryDigest: string, usedAt: Date): Promise<boolean> {
    const record = this.records.get(recoveryDigest);
    if (!record || record.usedAt) return false;
    this.records.set(recoveryDigest, { ...record, usedAt });
    return true;
  }

  async create(record: RecoveryCodeRecord): Promise<void> {
    this.records.set(record.recoveryDigest, structuredClone(record));
  }
}

function createServices() {
  const devices = new TestDeviceRepository();
  const recoveryCodes = new TestRecoveryCodeRepository();
  const deviceService = new DeviceService(devices, "test-device-pepper");
  const recoveryService = new RecoveryService({
    devices,
    recoveryCodes,
    devicePepper: "test-device-pepper",
    recoveryPepper: "test-recovery-pepper",
    clock: () => new Date("2026-09-12T02:00:00.000Z"),
  });
  return { devices, recoveryCodes, deviceService, recoveryService };
}

describe("RecoveryService", () => {
  test("rotates the device secret and recovery code while invalidating both old values", async () => {
    const { recoveryCodes, deviceService, recoveryService } = createServices();
    const original = await deviceService.register();
    const recoveryDigest = recoveryService.digestRecoveryCodeForImport("RECOVERY-CODE-001");
    recoveryCodes.records.set(recoveryDigest, {
      recoveryDigest,
      deviceId: original.deviceId,
      status: "active",
      createdAt: new Date("2026-09-12T01:00:00.000Z"),
    });

    const result = await recoveryService.recover({
      deviceId: original.deviceId,
      recoveryCode: "RECOVERY-CODE-001",
    });

    expect(result.device_id).toBe(original.deviceId);
    expect(result.device_secret).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(result.recovery_code).toMatch(/^REC-[A-Za-z0-9_-]{32}$/);
    await expect(deviceService.authenticate(original.deviceId, original.deviceSecret)).rejects.toMatchObject({
      code: "UNAUTHORIZED_DEVICE",
    });
    await expect(deviceService.authenticate(original.deviceId, result.device_secret)).resolves.toMatchObject({
      deviceId: original.deviceId,
      status: "active",
    });
    await expect(recoveryService.recover({
      deviceId: original.deviceId,
      recoveryCode: "RECOVERY-CODE-001",
    })).rejects.toEqual(new RecoveryCodeError());
    expect(JSON.stringify([...recoveryCodes.records.values()])).not.toContain("RECOVERY-CODE-001");
    expect(JSON.stringify([...recoveryCodes.records.values()])).not.toContain(result.recovery_code);
  });

  test("rejects unknown, disabled, expired and wrong-device recovery codes with the same public error", async () => {
    const { recoveryCodes, deviceService, recoveryService } = createServices();
    const first = await deviceService.register();
    const second = await deviceService.register();
    const disabledDigest = recoveryService.digestRecoveryCodeForImport("DISABLED-RECOVERY");
    const expiredDigest = recoveryService.digestRecoveryCodeForImport("EXPIRED-RECOVERY");
    const otherDeviceDigest = recoveryService.digestRecoveryCodeForImport("OTHER-DEVICE-RECOVERY");
    recoveryCodes.records.set(disabledDigest, {
      recoveryDigest: disabledDigest,
      deviceId: first.deviceId,
      status: "disabled",
      createdAt: new Date("2026-09-12T01:00:00.000Z"),
    });
    recoveryCodes.records.set(expiredDigest, {
      recoveryDigest: expiredDigest,
      deviceId: first.deviceId,
      status: "active",
      expiresAt: new Date("2026-09-11T02:00:00.000Z"),
      createdAt: new Date("2026-09-10T01:00:00.000Z"),
    });
    recoveryCodes.records.set(otherDeviceDigest, {
      recoveryDigest: otherDeviceDigest,
      deviceId: second.deviceId,
      status: "active",
      createdAt: new Date("2026-09-12T01:00:00.000Z"),
    });

    await expect(recoveryService.recover({ deviceId: first.deviceId, recoveryCode: "UNKNOWN" })).rejects.toEqual(
      new RecoveryCodeError(),
    );
    await expect(recoveryService.recover({
      deviceId: first.deviceId,
      recoveryCode: "DISABLED-RECOVERY",
    })).rejects.toEqual(new RecoveryCodeError());
    await expect(recoveryService.recover({
      deviceId: first.deviceId,
      recoveryCode: "EXPIRED-RECOVERY",
    })).rejects.toEqual(new RecoveryCodeError());
    await expect(recoveryService.recover({
      deviceId: first.deviceId,
      recoveryCode: "OTHER-DEVICE-RECOVERY",
    })).rejects.toEqual(new RecoveryCodeError());
  });
});
