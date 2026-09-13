export interface CloudBaseWhereClause {
  get(): Promise<{ data: unknown[] }>;
  update(patch: Record<string, unknown>): Promise<{ updated: number }>;
  limit(n: number): { update(patch: Record<string, unknown>): Promise<{ updated: number }> };
}

export interface CloudBaseRawCollection {
  add(data: Record<string, unknown>): Promise<{ id: string }>;
  where(filter: Record<string, unknown>): CloudBaseWhereClause;
}

export interface CloudBaseDomainCollection extends CloudBaseRawCollection {
  findActive(deviceId: string, at: string): Promise<unknown | null>;
  consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }>;
}

export interface DocumentStoreAdaptedCollection {
  insertOne(document: Record<string, unknown>): Promise<void>;
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }>;
  findActive(deviceId: string, at: string): Promise<unknown | null>;
  consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }>;
}

export function adaptCloudBaseCollection(raw: CloudBaseDomainCollection): DocumentStoreAdaptedCollection {
  return {
    async insertOne(document: Record<string, unknown>): Promise<void> {
      await raw.add(document);
    },
    async findOne(filter: Record<string, unknown>): Promise<unknown | null> {
      const result = await raw.where(filter).get();
      return result.data[0] ?? null;
    },
    async updateOne(
      filter: Record<string, unknown>,
      patch: Record<string, unknown>,
    ): Promise<{ modifiedCount: number }> {
      const result = await raw.where(filter).limit(1).update(patch);
      return { modifiedCount: result.updated };
    },
    findActive: (deviceId: string, at: string) => raw.findActive(deviceId, at),
    consumeOne: (deviceId: string, date: string, limit: number) => raw.consumeOne(deviceId, date, limit),
    insertIfAbsent: (document: Record<string, unknown>) => raw.insertIfAbsent(document),
  };
}
