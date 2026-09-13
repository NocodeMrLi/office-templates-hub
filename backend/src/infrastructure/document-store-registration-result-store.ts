import { z } from "zod";

import type { RegistrationResultStore } from "../app.js";

export interface DocumentStoreRegistrationResultCollection {
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }>;
}

interface RegistrationCredentials {
  deviceId: string;
  deviceSecret: string;
}

const RegistrationResultDocumentSchema = z.object({
  idempotency_key: z.string().min(1),
  device_id: z.string().min(1),
  device_secret: z.string().min(1),
});

export class DocumentStoreRegistrationResultStore implements RegistrationResultStore {
  constructor(private readonly collection: DocumentStoreRegistrationResultCollection) {}

  async getOrCreate(key: string, create: () => Promise<RegistrationCredentials>): Promise<RegistrationCredentials> {
    const existing = await this.findExisting(key);
    if (existing) return existing;

    const created = await create();
    const insert = await this.collection.insertIfAbsent({
      idempotency_key: key,
      device_id: created.deviceId,
      device_secret: created.deviceSecret,
    });
    if (insert.inserted) return created;

    const winner = await this.findExisting(key);
    if (!winner) {
      throw new Error("registration result missing after conflict");
    }
    return winner;
  }

  private async findExisting(key: string): Promise<RegistrationCredentials | null> {
    const document = await this.collection.findOne({ idempotency_key: key });
    const parsed = RegistrationResultDocumentSchema.safeParse(document);
    if (!parsed.success) return null;
    return {
      deviceId: parsed.data.device_id,
      deviceSecret: parsed.data.device_secret,
    };
  }
}
