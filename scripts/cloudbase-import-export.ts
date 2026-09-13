import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import type { CloudBaseImportBundle } from "./cloudbase-import-bundle.js";

export interface CloudBaseImportExportOptions {
  bundle: CloudBaseImportBundle;
  outDir: string;
}

export interface CloudBaseImportExportCollection {
  name: "templates" | "codes";
  file: string;
  format: "json_lines";
  count: number;
  sha256: string;
}

export interface CloudBaseImportExportResult {
  out_dir: string;
  collections: CloudBaseImportExportCollection[];
  manifest_file: "manifest.json";
}

export interface CloudBaseImportExportManifest {
  schema_version: "cloudbase-import-export/v1";
  source_schema_version: CloudBaseImportBundle["schema_version"];
  generated_at: string;
  collections: CloudBaseImportExportCollection[];
}

export function exportCloudBaseImportCollections(options: CloudBaseImportExportOptions): CloudBaseImportExportResult {
  mkdirSync(options.outDir, { recursive: true });
  const collections: CloudBaseImportExportCollection[] = [
    writeCollection(options.outDir, "templates", options.bundle.collections.templates.items),
    writeCollection(options.outDir, "codes", options.bundle.collections.codes.items),
  ];
  const manifest: CloudBaseImportExportManifest = {
    schema_version: "cloudbase-import-export/v1",
    source_schema_version: options.bundle.schema_version,
    generated_at: options.bundle.generated_at,
    collections,
  };
  writeJson(join(options.outDir, "manifest.json"), manifest);
  return {
    out_dir: options.outDir,
    collections,
    manifest_file: "manifest.json",
  };
}

function writeCollection(
  outDir: string,
  name: CloudBaseImportExportCollection["name"],
  items: Array<Record<string, unknown>>,
): CloudBaseImportExportCollection {
  const file = `${name}.json`;
  const path = join(outDir, file);
  const content = writeJsonLines(path, items);
  return {
    name,
    file,
    format: "json_lines",
    count: items.length,
    sha256: createHash("sha256").update(content).digest("hex"),
  };
}

function writeJsonLines(path: string, items: Array<Record<string, unknown>>): string {
  const content = items.length > 0
    ? `${items.map((item) => JSON.stringify(item)).join("\n")}\n`
    : "";
  writeFileSync(path, content);
  return content;
}

function writeJson(path: string, value: unknown): string {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  writeFileSync(path, content);
  return content;
}

function parseArgs(argv: readonly string[]): Record<string, string> {
  const args: Record<string, string> = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--") || !value) {
      throw new Error("Usage: tsx scripts/cloudbase-import-export.ts --bundle /private/cloudbase-import-bundle.json --out-dir /private/cloudbase-import");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const bundlePath = args.bundle;
  const outDir = args["out-dir"];
  if (!bundlePath || !outDir) {
    throw new Error("Missing required args: --bundle, --out-dir");
  }

  const bundle = JSON.parse(readFileSync(bundlePath, "utf8")) as CloudBaseImportBundle;
  const result = exportCloudBaseImportCollections({ bundle, outDir });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
