import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const XLSX_CONTENT_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export interface PublicCatalogForUpload {
  count: number;
  items: PublicCatalogUploadItem[];
}

export interface PublicCatalogUploadItem {
  product_id: string;
  public_id: string;
  display_name: string;
  access_tier: "free" | "paid";
}

export interface FinalAssetManifest {
  schema_version: string;
  base_dir: string;
  count: number;
  files: FinalAssetFile[];
}

export interface FinalAssetFile {
  rel_path: string;
  size: number;
  sha256: string;
}

export interface CosUploadManifestOptions {
  catalog: PublicCatalogForUpload;
  finalManifest: FinalAssetManifest;
  objectPrefix: string;
}

export interface CosUploadManifest {
  schema_version: "cos-upload-manifest/v1";
  source_schema_version: string;
  source_base_dir: string;
  object_prefix: string;
  count: number;
  total_size_bytes: number;
  items: CosUploadManifestItem[];
}

export interface CosUploadManifestItem {
  product_id: string;
  public_id: string;
  display_name: string;
  access_tier: "free" | "paid";
  source_rel_path: string;
  source_size: number;
  source_sha256: string;
  object_key: string;
  content_type: typeof XLSX_CONTENT_TYPE;
}

export interface CosUploadSourceVerification {
  checked: number;
  missing: string[];
  mismatched: Array<{
    source_rel_path: string;
    expected_size: number;
    actual_size: number;
    expected_sha256: string;
    actual_sha256: string;
  }>;
}

export function buildCosUploadManifest(options: CosUploadManifestOptions): CosUploadManifest {
  validateCatalog(options.catalog);
  validateFinalManifest(options.finalManifest);

  const objectPrefix = normalizeObjectPrefix(options.objectPrefix);
  const filesByProductId = new Map<string, FinalAssetFile>();

  for (const file of options.finalManifest.files) {
    const productId = parseProductId(file.rel_path);
    if (filesByProductId.has(productId)) {
      throw new Error(`Duplicate final asset for product_id ${productId}`);
    }
    filesByProductId.set(productId, file);
  }

  const items = options.catalog.items.map((catalogItem): CosUploadManifestItem => {
    const file = filesByProductId.get(catalogItem.product_id);
    if (!file) {
      throw new Error(`Missing final asset for product_id ${catalogItem.product_id}`);
    }
    return {
      product_id: catalogItem.product_id,
      public_id: catalogItem.public_id,
      display_name: catalogItem.display_name,
      access_tier: catalogItem.access_tier,
      source_rel_path: file.rel_path,
      source_size: file.size,
      source_sha256: file.sha256,
      object_key: `${objectPrefix}${catalogItem.public_id}.xlsx`,
      content_type: XLSX_CONTENT_TYPE,
    };
  });

  return {
    schema_version: "cos-upload-manifest/v1",
    source_schema_version: options.finalManifest.schema_version,
    source_base_dir: options.finalManifest.base_dir,
    object_prefix: objectPrefix,
    count: items.length,
    total_size_bytes: items.reduce((sum, item) => sum + item.source_size, 0),
    items,
  };
}

export function verifyCosUploadManifestSources(manifest: CosUploadManifest): CosUploadSourceVerification {
  const missing: string[] = [];
  const mismatched: CosUploadSourceVerification["mismatched"] = [];

  for (const item of manifest.items) {
    const sourcePath = join(manifest.source_base_dir, item.source_rel_path);
    if (!existsSync(sourcePath)) {
      missing.push(item.source_rel_path);
      continue;
    }
    const actualSize = statSync(sourcePath).size;
    const actualSha256 = createHash("sha256").update(readFileSync(sourcePath)).digest("hex");
    if (actualSize !== item.source_size || actualSha256 !== item.source_sha256) {
      mismatched.push({
        source_rel_path: item.source_rel_path,
        expected_size: item.source_size,
        actual_size: actualSize,
        expected_sha256: item.source_sha256,
        actual_sha256: actualSha256,
      });
    }
  }

  return {
    checked: manifest.items.length,
    missing,
    mismatched,
  };
}

function validateCatalog(catalog: PublicCatalogForUpload): void {
  if (catalog.count !== catalog.items.length) {
    throw new Error(`Catalog count mismatch: count=${catalog.count}, items=${catalog.items.length}`);
  }
  const productIds = new Set<string>();
  const publicIds = new Set<string>();
  for (const item of catalog.items) {
    if (!/^PMF-\d{4}$/.test(item.product_id)) {
      throw new Error(`Invalid product_id ${item.product_id}`);
    }
    if (!/^tpl_[a-z0-9]+$/.test(item.public_id)) {
      throw new Error(`Invalid public_id ${item.public_id}`);
    }
    if (item.access_tier !== "free" && item.access_tier !== "paid") {
      throw new Error(`Invalid access_tier for ${item.product_id}`);
    }
    if (productIds.has(item.product_id)) {
      throw new Error(`Duplicate catalog product_id ${item.product_id}`);
    }
    if (publicIds.has(item.public_id)) {
      throw new Error(`Duplicate catalog public_id ${item.public_id}`);
    }
    productIds.add(item.product_id);
    publicIds.add(item.public_id);
  }
}

function validateFinalManifest(manifest: FinalAssetManifest): void {
  if (manifest.count !== manifest.files.length) {
    throw new Error(`Final manifest count mismatch: count=${manifest.count}, files=${manifest.files.length}`);
  }
  for (const file of manifest.files) {
    if (!file.rel_path.endsWith(".xlsx")) {
      throw new Error(`Final asset is not an XLSX file: ${file.rel_path}`);
    }
    if (!Number.isSafeInteger(file.size) || file.size <= 0) {
      throw new Error(`Invalid size for ${file.rel_path}`);
    }
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) {
      throw new Error(`Invalid sha256 for ${file.rel_path}`);
    }
    parseProductId(file.rel_path);
  }
}

function parseProductId(relPath: string): string {
  const basename = relPath.split("/").at(-1) ?? relPath;
  const match = /^(PMF-\d{4})-.+\.xlsx$/.exec(basename);
  if (!match) {
    throw new Error(`Cannot parse product_id from ${relPath}`);
  }
  const productId = match[1];
  if (!productId) {
    throw new Error(`Cannot parse product_id from ${relPath}`);
  }
  return productId;
}

function normalizeObjectPrefix(prefix: string): string {
  const withoutLeadingSlash = prefix.replace(/^\/+/, "");
  if (!withoutLeadingSlash) return "";
  return withoutLeadingSlash.endsWith("/") ? withoutLeadingSlash : `${withoutLeadingSlash}/`;
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
      throw new Error("Usage: tsx scripts/cos-upload-manifest.ts --catalog data/catalog.public.json --final-manifest /path/final_manifest_v3.json --object-prefix templates/ --out /private/output/cos-upload-manifest.private.json");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const catalogPath = args.catalog;
  const finalManifestPath = args["final-manifest"];
  const objectPrefix = args["object-prefix"] ?? "templates/";
  const outPath = args.out;
  if (!catalogPath || !finalManifestPath || !outPath) {
    throw new Error("Missing required args: --catalog, --final-manifest, --out");
  }

  const manifest = buildCosUploadManifest({
    catalog: readJson<PublicCatalogForUpload>(catalogPath),
    finalManifest: readJson<FinalAssetManifest>(finalManifestPath),
    objectPrefix,
  });
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(manifest, null, 2)}\n`);
  const verification = args["verify-files"] === "true" ? verifyCosUploadManifestSources(manifest) : undefined;
  if (verification && (verification.missing.length > 0 || verification.mismatched.length > 0)) {
    console.error(JSON.stringify({ passed: false, verification }, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    out: outPath,
    count: manifest.count,
    total_size_bytes: manifest.total_size_bytes,
    object_prefix: manifest.object_prefix,
    ...(verification ? { source_verification: verification } : {}),
  }));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
