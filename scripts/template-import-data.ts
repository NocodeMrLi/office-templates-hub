import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import type {
  CosUploadManifest,
  PublicCatalogForUpload,
  PublicCatalogUploadItem,
} from "./cos-upload-manifest.js";

export interface TemplateImportDataOptions {
  catalog: PublicCatalogForUpload;
  uploadManifest: CosUploadManifest;
}

export interface TemplateImportData {
  schema_version: "template-import/v1";
  count: number;
  items: TemplateImportItem[];
}

export type TemplateImportItem = PublicCatalogUploadItem & {
  object_key: string;
  object_size: number;
  object_sha256: string;
  status: "active";
};

export function buildTemplateImportData(options: TemplateImportDataOptions): TemplateImportData {
  if (options.catalog.count !== options.catalog.items.length) {
    throw new Error(`Catalog count mismatch: count=${options.catalog.count}, items=${options.catalog.items.length}`);
  }
  if (options.uploadManifest.count !== options.uploadManifest.items.length) {
    throw new Error(`Upload manifest count mismatch: count=${options.uploadManifest.count}, items=${options.uploadManifest.items.length}`);
  }

  const uploadByPublicId = new Map(options.uploadManifest.items.map((item) => [item.public_id, item]));
  const items = options.catalog.items.map((catalogItem): TemplateImportItem => {
    const uploadItem = uploadByPublicId.get(catalogItem.public_id);
    if (!uploadItem) {
      throw new Error(`Missing upload manifest item for public_id ${catalogItem.public_id}`);
    }
    if (uploadItem.product_id !== catalogItem.product_id) {
      throw new Error(`Product id mismatch for public_id ${catalogItem.public_id}`);
    }
    return {
      ...catalogItem,
      object_key: uploadItem.object_key,
      object_size: uploadItem.source_size,
      object_sha256: uploadItem.source_sha256,
      status: "active",
    };
  });

  return {
    schema_version: "template-import/v1",
    count: items.length,
    items,
  };
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
      throw new Error("Usage: tsx scripts/template-import-data.ts --catalog data/catalog.public.json --upload-manifest /private/cos-upload-manifest.private.json --out /private/template-import.private.json");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = args.catalog;
  const uploadManifestPath = args["upload-manifest"];
  const outPath = args.out;
  if (!catalogPath || !uploadManifestPath || !outPath) {
    throw new Error("Missing required args: --catalog, --upload-manifest, --out");
  }

  const data = buildTemplateImportData({
    catalog: readJson<PublicCatalogForUpload>(catalogPath),
    uploadManifest: readJson<CosUploadManifest>(uploadManifestPath),
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(data, null, 2)}\n`);
  console.log(JSON.stringify({
    out: outPath,
    count: data.count,
    active: data.items.filter((item) => item.status === "active").length,
    free: data.items.filter((item) => item.access_tier === "free").length,
    paid: data.items.filter((item) => item.access_tier === "paid").length,
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
