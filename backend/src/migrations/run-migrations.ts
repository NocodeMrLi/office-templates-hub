export const COLLECTIONS = [
  "templates",
  "devices",
  "codes",
  "entitlements",
  "usage_daily",
  "ip_daily",
  "download_events",
  "complaints",
] as const;

export interface MigrationStore {
  hasMigration(id: string): Promise<boolean>;
  createCollection(name: string): Promise<void>;
  createUniqueIndex(collection: string, fields: readonly string[]): Promise<void>;
  recordMigration(id: string): Promise<void>;
}

export interface MigrationResult {
  applied: string[];
  skipped: string[];
}

const INITIAL_UNIQUE_INDEXES: Readonly<Record<(typeof COLLECTIONS)[number], readonly (readonly string[])[]>> = {
  templates: [["public_id"]],
  devices: [["device_id"]],
  codes: [["code_digest"]],
  entitlements: [["device_id"]],
  usage_daily: [["device_id", "date"]],
  ip_daily: [["ip_digest", "date"]],
  download_events: [["device_id", "idempotency_key"]],
  complaints: [],
};

const INITIAL_SCHEMA_ID = "001-initial-schema";

export async function runMigrations(store: MigrationStore): Promise<MigrationResult> {
  if (await store.hasMigration(INITIAL_SCHEMA_ID)) {
    return { applied: [], skipped: [INITIAL_SCHEMA_ID] };
  }

  for (const collection of COLLECTIONS) {
    await store.createCollection(collection);
    for (const fields of INITIAL_UNIQUE_INDEXES[collection]) {
      await store.createUniqueIndex(collection, fields);
    }
  }

  await store.recordMigration(INITIAL_SCHEMA_ID);
  return { applied: [INITIAL_SCHEMA_ID], skipped: [] };
}
