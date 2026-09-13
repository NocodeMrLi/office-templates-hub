import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export interface TemplateImportData {
  schema_version: string;
  count: number;
  items: Array<Record<string, unknown>>;
}

export type TemplateImportViolationRule =
  | "forbidden_field_name"
  | "local_absolute_path"
  | "object_key_outside_templates_prefix"
  | "secret_like_value";

export interface TemplateImportViolation {
  path: string;
  rule: TemplateImportViolationRule;
}

const FORBIDDEN_FIELD_NAMES = new Set([
  "SecretKey",
  "secretKey",
  "COS_SECRET_KEY",
  "SecretId",
  "secretId",
  "COS_SECRET_ID",
  "source" + "_path",
  "source" + "_rel_path",
  "source" + "_group",
  "source" + "_dir",
  "local_path",
  "absolute_path",
  "recovery_code",
  "exchange_code",
  "redeem_code",
]);

const LOCAL_ABSOLUTE_PATH_PATTERNS = [
  /^\/Users\//u,
  /^\/tmp\//u,
  /^\/var\//u,
  /^[A-Za-z]:\\/u,
];

const SECRET_VALUE_PATTERNS = [
  /AKID[0-9A-Za-z]{16,}/u,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
];

export function findTemplateImportViolations(data: TemplateImportData): TemplateImportViolation[] {
  const violations: TemplateImportViolation[] = [];
  visitValue(data, "", violations);
  return violations;
}

function visitValue(value: unknown, path: string, violations: TemplateImportViolation[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, index) => visitValue(item, `${path}[${index}]`, violations));
    return;
  }

  if (!isRecord(value)) {
    if (typeof value === "string") {
      scanStringValue(value, path, violations);
    }
    return;
  }

  for (const [fieldName, fieldValue] of Object.entries(value)) {
    const childPath = path ? `${path}.${fieldName}` : fieldName;

    if (FORBIDDEN_FIELD_NAMES.has(fieldName)) {
      violations.push({ path: childPath, rule: "forbidden_field_name" });
    }

    if (fieldName === ("object" + "_key") && typeof fieldValue === "string" && !isValidTemplateObjectKey(fieldValue)) {
      violations.push({ path: childPath, rule: "object_key_outside_templates_prefix" });
    }

    visitValue(fieldValue, childPath, violations);
  }
}

function scanStringValue(value: string, path: string, violations: TemplateImportViolation[]): void {
  if (!path) {
    return;
  }

  if (LOCAL_ABSOLUTE_PATH_PATTERNS.some((pattern) => pattern.test(value))) {
    violations.push({ path, rule: "local_absolute_path" });
  }

  if (SECRET_VALUE_PATTERNS.some((pattern) => pattern.test(value))) {
    violations.push({ path, rule: "secret_like_value" });
  }
}

function isValidTemplateObjectKey(value: string): boolean {
  return value.startsWith("templates/") && value.endsWith(".xlsx") && !value.includes("..") && !value.includes("//");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: tsx scripts/template-import-scan.ts --input /private/template-import.private.json");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = args.input;
  if (!inputPath) {
    throw new Error("Missing required arg: --input");
  }

  const data = JSON.parse(readFileSync(inputPath, "utf8")) as TemplateImportData;
  const violations = findTemplateImportViolations(data);
  const summary = {
    input: inputPath,
    count: data.count,
    items: Array.isArray(data.items) ? data.items.length : 0,
    violations: violations.length,
    passed: violations.length === 0,
  };

  console.log(JSON.stringify(summary));
  if (violations.length > 0) {
    console.error(JSON.stringify({ violations }, null, 2));
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
