import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface TemplateImportDataForBundle {
  schema_version: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface RedeemCodeImportDataForBundle {
  schema_version: string;
  batch_id: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface CloudBaseCollectionPayload {
  count: number;
  items: Array<Record<string, unknown>>;
}

export interface CloudBaseImportBundle {
  schema_version: "cloudbase-import-bundle/v1";
  generated_at: string;
  collections: {
    templates: CloudBaseCollectionPayload;
    codes: CloudBaseCollectionPayload;
  };
  summary: {
    templates: number;
    codes: number;
  };
}

export interface CloudBaseImportBundleOptions {
  templates: TemplateImportDataForBundle;
  codes?: RedeemCodeImportDataForBundle;
  generatedAt?: string;
}

const OBJECT_KEY_FIELD = "object" + "_key";
const PLAINTEXT_CODE_FIELD = "code";

export function buildCloudBaseImportBundle(options: CloudBaseImportBundleOptions): CloudBaseImportBundle {
  const templates = buildTemplateDocuments(options.templates);
  const codes = buildCodeDocuments(options.codes);
  const generatedAt = options.generatedAt ?? new Date().toISOString();

  return {
    schema_version: "cloudbase-import-bundle/v1",
    generated_at: generatedAt,
    collections: {
      templates: {
        count: templates.length,
        items: templates,
      },
      codes: {
        count: codes.length,
        items: codes,
      },
    },
    summary: {
      templates: templates.length,
      codes: codes.length,
    },
  };
}

function buildTemplateDocuments(data: TemplateImportDataForBundle): Array<Record<string, unknown>> {
  assertCount("templates", data.count, data.items.length);
  const ids = new Set<string>();
  return data.items.map((item, index) => {
    const publicId = requireString(item.public_id, `templates.items[${index}].public_id`);
    if (ids.has(publicId)) {
      throw new Error(`Duplicate templates _id ${publicId}`);
    }
    ids.add(publicId);
    const objectKey = requireString(item[OBJECT_KEY_FIELD], `templates.items[${index}].${OBJECT_KEY_FIELD}`);
    if (!objectKey.startsWith("templates/") || !objectKey.endsWith(".xlsx")) {
      throw new Error(`Invalid template object key at templates.items[${index}].${OBJECT_KEY_FIELD}`);
    }

    return {
      _id: publicId,
      ...item,
    };
  });
}

function buildCodeDocuments(data: RedeemCodeImportDataForBundle | undefined): Array<Record<string, unknown>> {
  if (!data) return [];
  assertCount("codes", data.count, data.items.length);
  const ids = new Set<string>();
  return data.items.map((item, index) => {
    if (Object.hasOwn(item, PLAINTEXT_CODE_FIELD)) {
      throw new Error(`Forbidden plaintext code field at codes.items[${index}].code`);
    }
    const digest = requireString(item.code_digest, `codes.items[${index}].code_digest`);
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Invalid code digest at codes.items[${index}].code_digest`);
    }
    if (ids.has(digest)) {
      throw new Error(`Duplicate codes _id ${digest}`);
    }
    ids.add(digest);
    return {
      _id: digest,
      ...item,
    };
  });
}

function assertCount(label: string, declared: number, actual: number): void {
  if (declared !== actual) {
    throw new Error(`${label} count mismatch: count=${declared}, items=${actual}`);
  }
}

function requireString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required string at ${path}`);
  }
  return value;
}

function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: tsx scripts/cloudbase-import-bundle.ts --templates-import /private/template-import.json --out /private/cloudbase-import-bundle.json [--codes-import /private/redeem-code-import.json]");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const templatesPath = args["templates-import"];
  const codesPath = args["codes-import"];
  const outPath = args.out;
  if (!templatesPath || !outPath) {
    throw new Error("Missing required args: --templates-import, --out");
  }

  const bundle = buildCloudBaseImportBundle({
    templates: readJson<TemplateImportDataForBundle>(templatesPath),
    ...(codesPath ? { codes: readJson<RedeemCodeImportDataForBundle>(codesPath) } : {}),
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(bundle, null, 2)}\n`);
  console.log(JSON.stringify({
    out: outPath,
    schema_version: bundle.schema_version,
    templates: bundle.summary.templates,
    codes: bundle.summary.codes,
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
