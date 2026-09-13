import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface PostgresImportSqlOptions {
  collection: string;
  jsonLinesPath: string;
}

export interface PostgresImportSqlResult {
  sql: string;
  count: number;
}

export function buildPostgresImportSql(options: PostgresImportSqlOptions): PostgresImportSqlResult {
  const collection = quoteIdent(options.collection);
  const content = readFileSync(options.jsonLinesPath, "utf8");
  const documents = content
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => parseJsonObject(line, index + 1));
  const inserts = documents.map((document) =>
    `INSERT INTO ${collection} (doc) VALUES (${jsonbSqlLiteral(document)});`);
  return {
    sql: `${["BEGIN;", ...inserts, "COMMIT;"].join("\n")}\n`,
    count: documents.length,
  };
}

function parseJsonObject(line: string, lineNumber: number): Record<string, unknown> {
  const parsed = JSON.parse(line) as unknown;
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Line ${lineNumber} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function jsonbSqlLiteral(value: Record<string, unknown>): string {
  return `'${JSON.stringify(value).replace(/'/g, "''")}'::jsonb`;
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
      throw new Error("Usage: tsx scripts/postgres-import-sql.ts --collection templates --jsonl /private/templates.json --out /private/templates-import.sql");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const collection = args.collection;
  const jsonLinesPath = args.jsonl;
  const out = args.out;
  if (!collection || !jsonLinesPath || !out) {
    throw new Error("Missing required args: --collection, --jsonl, --out");
  }
  const result = buildPostgresImportSql({ collection, jsonLinesPath });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, result.sql);
  console.log(JSON.stringify({ out, collection, count: result.count }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
