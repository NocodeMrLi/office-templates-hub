import { createHmac, randomBytes as nodeRandomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export type RedeemCodeType = "afdian_month";

export interface RedeemCodeDeliveryItem {
  sequence: number;
  code: string;
}

export interface RedeemCodeImportData {
  schema_version: "redeem-code-import/v1";
  batch_id: string;
  count: number;
  items: RedeemCodeImportItem[];
}

export interface RedeemCodeImportItem {
  code_digest: string;
  type: RedeemCodeType;
  status: "active";
  source_order_id: string;
  created_at: string;
}

export interface RedeemCodeBatch {
  delivery_codes: RedeemCodeDeliveryItem[];
  import_data: RedeemCodeImportData;
}

export interface RedeemCodeBatchOptions {
  type: RedeemCodeType;
  count: number;
  batchId: string;
  pepper: string;
  now?: Date;
  randomBytes?: (size: number) => Buffer;
}

const CODE_RANDOM_BYTES = 20;
const MAX_COUNT = 10_000;

export function buildRedeemCodeBatch(options: RedeemCodeBatchOptions): RedeemCodeBatch {
  if (!Number.isSafeInteger(options.count) || options.count < 1 || options.count > MAX_COUNT) {
    throw new Error(`count must be between 1 and ${MAX_COUNT}`);
  }
  if (!/^[a-z0-9][a-z0-9-]{2,80}$/i.test(options.batchId)) {
    throw new Error("batchId must be 3-81 chars using letters, numbers, and hyphen");
  }
  if (options.pepper.length < 16) {
    throw new Error("pepper must be at least 16 characters");
  }

  const randomBytes = options.randomBytes ?? nodeRandomBytes;
  const createdAt = (options.now ?? new Date()).toISOString();
  const seenCodes = new Set<string>();
  const delivery_codes: RedeemCodeDeliveryItem[] = [];
  const items: RedeemCodeImportItem[] = [];

  for (let index = 1; index <= options.count; index += 1) {
    const code = nextUniqueCode(randomBytes, seenCodes);
    delivery_codes.push({ sequence: index, code });
    items.push({
      code_digest: digestCode(code, options.pepper),
      type: options.type,
      status: "active",
      source_order_id: `${options.batchId}-${String(index).padStart(4, "0")}`,
      created_at: createdAt,
    });
  }

  return {
    delivery_codes,
    import_data: {
      schema_version: "redeem-code-import/v1",
      batch_id: options.batchId,
      count: items.length,
      items,
    },
  };
}

function nextUniqueCode(randomBytes: (size: number) => Buffer, seenCodes: Set<string>): string {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const code = `AF-${randomBytes(CODE_RANDOM_BYTES).toString("base64url")}`;
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      return code;
    }
  }
  throw new Error("failed to generate a unique code after 100 attempts");
}

function digestCode(code: string, pepper: string): string {
  return createHmac("sha256", pepper).update(code, "utf8").digest("hex");
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: CODE_SECRET_PEPPER=... tsx scripts/redeem-code-batch.ts --type afdian_month --count 1000 --batch-id afdian-20260913 --codes-out /private/codes.txt --import-out /private/redeem-code-import.json");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const type = args.type as RedeemCodeType | undefined;
  const count = Number(args.count);
  const batchId = args["batch-id"];
  const codesOut = args["codes-out"];
  const importOut = args["import-out"];
  const pepper = process.env.CODE_SECRET_PEPPER;

  if (type !== "afdian_month" || !Number.isFinite(count) || !batchId || !codesOut || !importOut || !pepper) {
    throw new Error("Missing required args/env: --type afdian_month, --count, --batch-id, --codes-out, --import-out, CODE_SECRET_PEPPER");
  }

  const batch = buildRedeemCodeBatch({ type, count, batchId, pepper });
  mkdirSync(dirname(codesOut), { recursive: true });
  mkdirSync(dirname(importOut), { recursive: true });
  writeFileSync(codesOut, `${batch.delivery_codes.map((item) => item.code).join("\n")}\n`);
  writeFileSync(importOut, `${JSON.stringify(batch.import_data, null, 2)}\n`);

  console.log(JSON.stringify({
    batch_id: batch.import_data.batch_id,
    count: batch.import_data.count,
    codes_out: codesOut,
    import_out: importOut,
    plaintext_codes_written: batch.delivery_codes.length,
    import_plaintext_codes: 0,
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
