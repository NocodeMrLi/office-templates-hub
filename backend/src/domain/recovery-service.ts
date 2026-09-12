import { createHmac, randomBytes } from "node:crypto";

import type { DeviceRepository } from "./device-service.js";

export type RecoveryCodeStatus = "active" | "disabled";

export interface RecoveryCodeRecord {
  recoveryDigest: string;
  deviceId: string;
  status: RecoveryCodeStatus;
  createdAt: Date;
  expiresAt?: Date;
  usedAt?: Date;
}

export interface RecoveryCodeRepository {
  findByDigest(recoveryDigest: string): Promise<RecoveryCodeRecord | null>;
  markUsed(recoveryDigest: string, usedAt: Date): Promise<boolean>;
  create(record: RecoveryCodeRecord): Promise<void>;
}

export interface RecoveryServiceDependencies {
  devices: DeviceRepository;
  recoveryCodes: RecoveryCodeRepository;
  devicePepper: string;
  recoveryPepper: string;
  clock?: () => Date;
}

export interface RecoverRequest {
  deviceId: string;
  recoveryCode: string;
}

export interface RecoverResult {
  device_id: string;
  device_secret: string;
  recovery_code: string;
}

export class RecoveryCodeError extends Error {
  readonly code = "INVALID_RECOVERY_CODE";

  constructor() {
    super("恢复码无效或已失效");
  }
}

export class RecoveryService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: RecoveryServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  digestRecoveryCodeForImport(recoveryCode: string): string {
    return this.digest(recoveryCode, this.dependencies.recoveryPepper);
  }

  async recover(request: RecoverRequest): Promise<RecoverResult> {
    const now = this.clock();
    const recoveryDigest = this.digestRecoveryCodeForImport(request.recoveryCode);
    const record = await this.dependencies.recoveryCodes.findByDigest(recoveryDigest);
    if (!record || !this.canRecover(record, request.deviceId, now)) {
      throw new RecoveryCodeError();
    }

    const marked = await this.dependencies.recoveryCodes.markUsed(recoveryDigest, now);
    if (!marked) {
      throw new RecoveryCodeError();
    }

    const nextDeviceSecret = randomBytes(32).toString("base64url");
    const nextRecoveryCode = `REC-${randomBytes(24).toString("base64url")}`;
    await this.dependencies.devices.replaceSecret(
      request.deviceId,
      this.digest(nextDeviceSecret, this.dependencies.devicePepper),
      now,
    );
    await this.dependencies.recoveryCodes.create({
      recoveryDigest: this.digestRecoveryCodeForImport(nextRecoveryCode),
      deviceId: request.deviceId,
      status: "active",
      createdAt: now,
    });

    return {
      device_id: request.deviceId,
      device_secret: nextDeviceSecret,
      recovery_code: nextRecoveryCode,
    };
  }

  private canRecover(record: RecoveryCodeRecord, deviceId: string, now: Date): boolean {
    return record.deviceId === deviceId
      && record.status === "active"
      && !record.usedAt
      && (record.expiresAt === undefined || record.expiresAt.getTime() > now.getTime());
  }

  private digest(value: string, pepper: string): string {
    return createHmac("sha256", pepper).update(value, "utf8").digest("hex");
  }
}
