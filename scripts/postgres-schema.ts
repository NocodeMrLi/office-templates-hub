import { writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

interface CollectionSchema {
  name: string;
  uniqueIndexes: Array<{ name: string; fields: string[] }>;
}

const COLLECTIONS: CollectionSchema[] = [
  { name: "templates", uniqueIndexes: [{ name: "public_id", fields: ["public_id"] }] },
  { name: "devices", uniqueIndexes: [{ name: "device_id", fields: ["device_id"] }] },
  { name: "codes", uniqueIndexes: [{ name: "code_digest", fields: ["code_digest"] }] },
  { name: "entitlements", uniqueIndexes: [{ name: "source_order_id", fields: ["source_order_id"] }] },
  { name: "usage_daily", uniqueIndexes: [{ name: "device_id_date", fields: ["device_id", "date"] }] },
  { name: "recovery_codes", uniqueIndexes: [{ name: "recovery_digest", fields: ["recovery_digest"] }] },
  { name: "download_events", uniqueIndexes: [{ name: "device_id_idempotency_key", fields: ["device_id", "idempotency_key"] }] },
  { name: "registration_results", uniqueIndexes: [{ name: "idempotency_key", fields: ["idempotency_key"] }] },
];

export function buildPostgresSchemaSql(): string {
  const statements: string[] = [
    "BEGIN;",
    ...COLLECTIONS.flatMap((collection) => [
      `CREATE TABLE IF NOT EXISTS ${quoteIdent(collection.name)} (doc jsonb NOT NULL);`,
      `CREATE INDEX IF NOT EXISTS ${quoteIdent(`${collection.name}_doc_gin_idx`)} ON ${quoteIdent(collection.name)} USING GIN (doc);`,
      ...collection.uniqueIndexes.map((index) =>
        `CREATE UNIQUE INDEX IF NOT EXISTS ${quoteIdent(`${collection.name}_${index.name}_uidx`)}
ON ${quoteIdent(collection.name)} (${index.fields.map((field) => `(doc->>'${field}')`).join(", ")});`),
    ]),
    "COMMIT;",
  ];
  return `${statements.join("\n")}\n`;
}

function quoteIdent(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/u.test(value)) {
    throw new Error(`Invalid PostgreSQL identifier: ${value}`);
  }
  return `"${value}"`;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: tsx scripts/postgres-schema.ts --out /private/postgres-schema.sql");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const out = args.out;
  if (!out) {
    throw new Error("Missing required arg: --out");
  }
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, buildPostgresSchemaSql());
  console.log(JSON.stringify({ out, collections: COLLECTIONS.length }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
