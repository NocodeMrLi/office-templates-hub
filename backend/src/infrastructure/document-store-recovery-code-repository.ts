import { z } from "zod";

import type { RecoveryCodeRecord, RecoveryCodeRepository } from "../domain/recovery-service.js";

export interface DocumentStoreRecoveryCodeCollection {
  insertOne(document: Record<string, unknown>): Promise<void>;
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }>;
}

const RecoveryCodeDocumentSchema = z.object({
  recovery_digest: z.string().min(1),
  device_id: z.string().min(1),
  status: z.enum(["active", "disabled"]),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime().optional().nullable(),
  used_at: z.string().datetime().optional().nullable(),
});

export class DocumentStoreRecoveryCodeRepository implements RecoveryCodeRepository {
  constructor(private readonly collection: DocumentStoreRecoveryCodeCollection) {}

  async findByDigest(recoveryDigest: string): Promise<RecoveryCodeRecord | null> {
    const document = await this.collection.findOne({ recovery_digest: recoveryDigest });
    const parsed = RecoveryCodeDocumentSchema.safeParse(document);
    if (!parsed.success) return null;
    return {
      recoveryDigest: parsed.data.recovery_digest,
      deviceId: parsed.data.device_id,
      status: parsed.data.status,
      createdAt: new Date(parsed.data.created_at),
      ...(parsed.data.expires_at ? { expiresAt: new Date(parsed.data.expires_at) } : {}),
      ...(parsed.data.used_at ? { usedAt: new Date(parsed.data.used_at) } : {}),
    };
  }

  async markUsed(recoveryDigest: string, usedAt: Date): Promise<boolean> {
    const result = await this.collection.updateOne(
      { recovery_digest: recoveryDigest, used_at: null },
      { used_at: usedAt.toISOString() },
    );
    return result.modifiedCount === 1;
  }

  async create(record: RecoveryCodeRecord): Promise<void> {
    await this.collection.insertOne({
      recovery_digest: record.recoveryDigest,
      device_id: record.deviceId,
      status: record.status,
      created_at: record.createdAt.toISOString(),
      ...(record.expiresAt ? { expires_at: record.expiresAt.toISOString() } : {}),
      ...(record.usedAt ? { used_at: record.usedAt.toISOString() } : {}),
    });
  }
}
