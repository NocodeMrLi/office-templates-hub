import { z } from "zod";

import type { DeviceRecord, DeviceRepository } from "../domain/device-service.js";

export interface DocumentStoreDeviceCollection {
  insertOne(document: Record<string, unknown>): Promise<void>;
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }>;
}

const DeviceDocumentSchema = z.object({
  device_id: z.string().min(1),
  secret_digest: z.string().min(1),
  status: z.enum(["active", "disabled"]),
  created_at: z.string().datetime(),
  rotated_at: z.string().datetime().optional().nullable(),
});

export class DocumentStoreDeviceRepository implements DeviceRepository {
  constructor(private readonly collection: DocumentStoreDeviceCollection) {}

  async create(record: DeviceRecord): Promise<void> {
    await this.collection.insertOne({
      device_id: record.deviceId,
      secret_digest: record.secretDigest,
      status: record.status,
      created_at: record.createdAt.toISOString(),
      ...(record.rotatedAt ? { rotated_at: record.rotatedAt.toISOString() } : {}),
    });
  }

  async findById(deviceId: string): Promise<DeviceRecord | null> {
    const document = await this.collection.findOne({ device_id: deviceId });
    const parsed = DeviceDocumentSchema.safeParse(document);
    if (!parsed.success) return null;
    return {
      deviceId: parsed.data.device_id,
      secretDigest: parsed.data.secret_digest,
      status: parsed.data.status,
      createdAt: new Date(parsed.data.created_at),
      ...(parsed.data.rotated_at ? { rotatedAt: new Date(parsed.data.rotated_at) } : {}),
    };
  }

  async replaceSecret(deviceId: string, secretDigest: string, rotatedAt: Date): Promise<void> {
    const result = await this.collection.updateOne(
      { device_id: deviceId },
      { secret_digest: secretDigest, rotated_at: rotatedAt.toISOString() },
    );
    if (result.modifiedCount !== 1) {
      throw new Error("device missing");
    }
  }
}
