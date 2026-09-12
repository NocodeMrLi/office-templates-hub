export type DeviceStatus = "active" | "disabled";

export interface DeviceRecord {
  deviceId: string;
  secretDigest: string;
  status: DeviceStatus;
  createdAt: Date;
  rotatedAt?: Date;
}

export interface DeviceRepository {
  create(record: DeviceRecord): Promise<void>;
  findById(deviceId: string): Promise<DeviceRecord | null>;
  replaceSecret(deviceId: string, secretDigest: string, rotatedAt: Date): Promise<void>;
}

export class DeviceAuthError extends Error {
  readonly code = "UNAUTHORIZED_DEVICE";

  constructor() {
    super("设备凭证无效");
  }
}

export class DeviceService {
  constructor(
    private readonly repository: DeviceRepository,
    private readonly pepper: string,
  ) {}

  async register(): Promise<{ deviceId: string; deviceSecret: string }> {
    const deviceId = randomUUID();
    const deviceSecret = randomBytes(32).toString("base64url");
    await this.repository.create({
      deviceId,
      secretDigest: this.digest(deviceSecret),
      status: "active",
      createdAt: new Date(),
    });
    return { deviceId, deviceSecret };
  }

  async authenticate(deviceId: string, deviceSecret: string): Promise<DeviceRecord> {
    const record = await this.repository.findById(deviceId);
    if (!record || record.status !== "active" || !this.matches(deviceSecret, record.secretDigest)) {
      throw new DeviceAuthError();
    }
    return record;
  }

  async rotateSecret(deviceId: string, deviceSecret: string): Promise<{ deviceId: string; deviceSecret: string }> {
    await this.authenticate(deviceId, deviceSecret);
    const nextSecret = randomBytes(32).toString("base64url");
    await this.repository.replaceSecret(deviceId, this.digest(nextSecret), new Date());
    return { deviceId, deviceSecret: nextSecret };
  }

  private digest(secret: string): string {
    return createHmac("sha256", this.pepper).update(secret, "utf8").digest("hex");
  }

  private matches(secret: string, storedDigest: string): boolean {
    const actual = Buffer.from(this.digest(secret), "hex");
    const expected = Buffer.from(storedDigest, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
}
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
