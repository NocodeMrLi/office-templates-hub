import { z } from "zod";

import type { RuntimeEntitlementRepository } from "../runtime-app.js";
import type { EntitlementRecord, UsageQuotaRepository } from "../domain/usage-quota-service.js";

export interface DocumentStoreEntitlementCollection {
  insertOne(document: Record<string, unknown>): Promise<void>;
  findActive(deviceId: string, at: string): Promise<unknown | null>;
}

export interface DocumentStoreUsageDailyCollection {
  consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }>;
}

const EntitlementDocumentSchema = z.object({
  device_id: z.string().min(1),
  source: z.literal("afdian"),
  source_order_id: z.string().min(1),
  starts_at: z.string().datetime(),
  expires_at: z.string().datetime(),
  created_at: z.string().datetime(),
});

export class DocumentStoreUsageQuotaRepository implements RuntimeEntitlementRepository, UsageQuotaRepository {
  constructor(
    private readonly entitlements: DocumentStoreEntitlementCollection,
    private readonly usageDaily: DocumentStoreUsageDailyCollection,
  ) {}

  async createEntitlement(record: EntitlementRecord): Promise<void> {
    await this.entitlements.insertOne({
      device_id: record.deviceId,
      source: record.source,
      source_order_id: record.sourceOrderId,
      starts_at: record.startsAt.toISOString(),
      expires_at: record.expiresAt.toISOString(),
      created_at: record.createdAt.toISOString(),
    });
  }

  async findActiveEntitlement(deviceId: string, at: Date): Promise<EntitlementRecord | null> {
    const document = await this.entitlements.findActive(deviceId, at.toISOString());
    const parsed = EntitlementDocumentSchema.safeParse(document);
    if (!parsed.success) return null;
    return {
      deviceId: parsed.data.device_id,
      source: parsed.data.source,
      sourceOrderId: parsed.data.source_order_id,
      startsAt: new Date(parsed.data.starts_at),
      expiresAt: new Date(parsed.data.expires_at),
      createdAt: new Date(parsed.data.created_at),
    };
  }

  async hasPaidAccess(deviceId: string, at: Date): Promise<boolean> {
    return (await this.findActiveEntitlement(deviceId, at)) !== null;
  }

  async consumeDaily(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    return this.usageDaily.consumeOne(deviceId, date, limit);
  }
}
