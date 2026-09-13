export interface CloudBaseWhereClause {
  get(): Promise<{ data: unknown[] }>;
  update(patch: Record<string, unknown>): Promise<{ updated: number }>;
  limit(n: number): {
    get(): Promise<{ data: unknown[] }>;
    update(patch: Record<string, unknown>): Promise<{ updated: number }>;
  };
}

export interface CloudBaseRawCollection {
  add(data: Record<string, unknown>): Promise<{ id: string }>;
  where(filter: Record<string, unknown>): CloudBaseWhereClause;
}

export interface CloudBaseCommand {
  gt(value: unknown): unknown;
  lte(value: unknown): unknown;
  lt(value: unknown): unknown;
  inc(value: number): unknown;
}

export interface DocumentStoreAdaptedCollection {
  insertOne(document: Record<string, unknown>): Promise<void>;
  findOne(filter: Record<string, unknown>): Promise<unknown | null>;
  updateOne(filter: Record<string, unknown>, patch: Record<string, unknown>): Promise<{ modifiedCount: number }>;
  findActive(deviceId: string, at: string): Promise<unknown | null>;
  consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }>;
  insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }>;
}

export interface CloudBaseCollectionAdapterOptions {
  command?: CloudBaseCommand;
  now?: () => Date;
}

export function adaptCloudBaseCollection(
  raw: CloudBaseRawCollection,
  options: CloudBaseCollectionAdapterOptions = {},
): DocumentStoreAdaptedCollection {
  const now = options.now ?? (() => new Date());
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
    async findActive(deviceId: string, at: string): Promise<unknown | null> {
      const command = requireCommand(options.command, "findActive");
      const result = await raw.where({
        device_id: deviceId,
        status: "active",
        starts_at: command.lte(at),
        expires_at: command.gt(at),
      }).limit(1).get();
      return result.data[0] ?? null;
    },
    async consumeOne(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }> {
      const command = requireCommand(options.command, "consumeOne");
      const existing = await findUsageDocument(raw, deviceId, date);
      if (!existing) {
        try {
          await raw.add({
            device_id: deviceId,
            date,
            limit,
            used: 1,
            created_at: now().toISOString(),
            updated_at: now().toISOString(),
          });
          return { allowed: true, used: 1 };
        } catch (error) {
          if (!isDuplicateKeyError(error)) throw error;
        }
      } else if (readUsed(existing) >= limit) {
        return { allowed: false, used: readUsed(existing) };
      }

      const update = await raw.where({
        device_id: deviceId,
        date,
        used: command.lt(limit),
      }).limit(1).update({
        limit,
        used: command.inc(1),
        updated_at: now().toISOString(),
      });
      const updated = await findUsageDocument(raw, deviceId, date);
      const used = updated ? readUsed(updated) : limit;
      return { allowed: update.updated === 1, used };
    },
    async insertIfAbsent(document: Record<string, unknown>): Promise<{ inserted: boolean }> {
      try {
        await raw.add(document);
        return { inserted: true };
      } catch (error) {
        if (isDuplicateKeyError(error)) {
          return { inserted: false };
        }
        throw error;
      }
    },
  };
}

async function findUsageDocument(
  raw: CloudBaseRawCollection,
  deviceId: string,
  date: string,
): Promise<Record<string, unknown> | null> {
  const result = await raw.where({ device_id: deviceId, date }).limit(1).get();
  const first = result.data[0];
  return isRecord(first) ? first : null;
}

function readUsed(document: Record<string, unknown>): number {
  const used = document.used;
  return Number.isInteger(used) && typeof used === "number" ? used : 0;
}

function requireCommand(command: CloudBaseCommand | undefined, operation: string): CloudBaseCommand {
  if (!command) {
    throw new Error(`CloudBase command is required for ${operation}`);
  }
  return command;
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!isRecord(error)) return false;
  const code = String(error.code ?? "");
  const message = String(error.message ?? "");
  return code.includes("DUP") || code.includes("duplicate") || message.toLowerCase().includes("duplicate");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
