import { z } from "zod";

import type { DownloadEvent, DownloadEventRepository, DownloadResult } from "../domain/download-service.js";

export interface DocumentStoreDownloadEventCollection {
  insertOne(document: Record<string, unknown>): Promise<void>;
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }>;
}

const DownloadResultSchema = z.object({
  public_id: z.string().min(1),
  download_url: z.string().min(1),
  expires_at: z.string().datetime(),
  sha256: z.string().min(1),
  quota_remaining: z.number().int().nonnegative(),
});

const DownloadEventDocumentSchema = z.object({
  device_id: z.string().min(1),
  idempotency_key: z.string().min(1),
  public_id: z.string().min(1),
  state: z.enum(["received", "authenticated", "reserved", "signed", "delivered", "released"]),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  reservation_id: z.string().min(1).optional().nullable(),
  result: DownloadResultSchema.optional().nullable(),
});

export class DocumentStoreDownloadEventRepository implements DownloadEventRepository {
  constructor(private readonly collection: DocumentStoreDownloadEventCollection) {}

  async findByDeviceAndKey(deviceId: string, idempotencyKey: string): Promise<DownloadEvent | null> {
    const document = await this.collection.findOne({ device_id: deviceId, idempotency_key: idempotencyKey });
    return parseDownloadEventDocument(document);
  }

  async create(event: DownloadEvent): Promise<void> {
    await this.collection.insertOne(serializeDownloadEvent(event));
  }

  async save(event: DownloadEvent): Promise<void> {
    const document = serializeDownloadEvent(event);
    const { device_id, idempotency_key, ...patch } = document;
    const result = await this.collection.updateOne({ device_id, idempotency_key }, patch);
    if (result.modifiedCount !== 1) {
      throw new Error("download event missing");
    }
  }
}

function parseDownloadEventDocument(document: unknown): DownloadEvent | null {
  const parsed = DownloadEventDocumentSchema.safeParse(document);
  if (!parsed.success) return null;
  return {
    deviceId: parsed.data.device_id,
    idempotencyKey: parsed.data.idempotency_key,
    publicId: parsed.data.public_id,
    state: parsed.data.state,
    createdAt: new Date(parsed.data.created_at),
    updatedAt: new Date(parsed.data.updated_at),
    ...(parsed.data.reservation_id ? { reservationId: parsed.data.reservation_id } : {}),
    ...(parsed.data.result ? { result: parsed.data.result as DownloadResult } : {}),
  };
}

function serializeDownloadEvent(event: DownloadEvent): Record<string, unknown> {
  return {
    device_id: event.deviceId,
    idempotency_key: event.idempotencyKey,
    public_id: event.publicId,
    state: event.state,
    created_at: event.createdAt.toISOString(),
    updated_at: event.updatedAt.toISOString(),
    ...(event.reservationId ? { reservation_id: event.reservationId } : {}),
    result: event.result ?? null,
  };
}
