import { z } from "zod";

import type { CodeRecord, CodeRepository } from "../domain/redeem-service.js";

export interface DocumentStoreCodeCollection {
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }>;
}

const CodeDocumentSchema = z.object({
  code_digest: z.string().min(1),
  type: z.literal("afdian_month"),
  status: z.enum(["active", "disabled"]),
  source_order_id: z.string().min(1),
  created_at: z.string().datetime(),
  expires_at: z.string().datetime().optional().nullable(),
  redeemed_by_device_id: z.string().min(1).optional().nullable(),
  redeemed_at: z.string().datetime().optional().nullable(),
});

export class DocumentStoreCodeRepository implements CodeRepository {
  constructor(private readonly collection: DocumentStoreCodeCollection) {}

  async findByDigest(codeDigest: string): Promise<CodeRecord | null> {
    const document = await this.collection.findOne({ code_digest: codeDigest });
    const parsed = CodeDocumentSchema.safeParse(document);
    if (!parsed.success) return null;
    return {
      codeDigest: parsed.data.code_digest,
      type: parsed.data.type,
      status: parsed.data.status,
      sourceOrderId: parsed.data.source_order_id,
      createdAt: new Date(parsed.data.created_at),
      ...(parsed.data.expires_at ? { expiresAt: new Date(parsed.data.expires_at) } : {}),
      ...(parsed.data.redeemed_by_device_id ? { redeemedByDeviceId: parsed.data.redeemed_by_device_id } : {}),
      ...(parsed.data.redeemed_at ? { redeemedAt: new Date(parsed.data.redeemed_at) } : {}),
    };
  }

  async markRedeemed(codeDigest: string, deviceId: string, redeemedAt: Date): Promise<boolean> {
    const result = await this.collection.updateOne(
      { code_digest: codeDigest, redeemed_at: null },
      { redeemed_by_device_id: deviceId, redeemed_at: redeemedAt.toISOString() },
    );
    return result.modifiedCount === 1;
  }
}
