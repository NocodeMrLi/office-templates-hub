import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  verifyCosUploadManifestSources,
  type CosUploadManifest,
  type CosUploadManifestItem,
} from "./cos-upload-manifest.js";

export interface CosPutObjectParams {
  Bucket: string;
  Region: string;
  Key: string;
  Body: Buffer;
  ContentLength: number;
  ContentType: string;
  "x-cos-meta-public-id": string;
  "x-cos-meta-product-id": string;
  "x-cos-meta-sha256": string;
  "x-cos-meta-access-tier": string;
}

export interface CosAssetUploadClient {
  putObject(params: CosPutObjectParams): Promise<unknown>;
}

export interface UploadCosAssetsOptions {
  client: CosAssetUploadClient;
  bucket: string;
  region: string;
  manifest: CosUploadManifest;
  dryRun?: boolean;
  continueOnError?: boolean;
  onProgress?: (progress: { processed: number; total: number; uploaded: number; skipped: number; failed: number }) => void;
}

export interface UploadCosAssetsResult {
  total: number;
  uploaded: number;
  skipped: number;
  failed: number;
  failures: Array<{
    object_key: string;
    message: string;
  }>;
  dry_run: boolean;
}

export async function uploadCosAssets(options: UploadCosAssetsOptions): Promise<UploadCosAssetsResult> {
  const sourceVerification = verifyCosUploadManifestSources(options.manifest);
  if (sourceVerification.missing.length > 0 || sourceVerification.mismatched.length > 0) {
    throw new Error(`Source verification failed: missing=${sourceVerification.missing.length}, mismatched=${sourceVerification.mismatched.length}`);
  }

  const result: UploadCosAssetsResult = {
    total: options.manifest.items.length,
    uploaded: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    dry_run: options.dryRun === true,
  };

  for (const item of options.manifest.items) {
    if (options.dryRun) {
      result.skipped += 1;
      emitProgress(options, result);
      continue;
    }
    try {
      await options.client.putObject(toPutObjectParams(options, item));
      result.uploaded += 1;
    } catch (error) {
      result.failed += 1;
      result.failures.push({
        object_key: item.object_key,
        message: error instanceof Error ? error.message : "unknown upload error",
      });
      if (!options.continueOnError) {
        break;
      }
    }
    emitProgress(options, result);
  }

  return result;
}

function emitProgress(options: UploadCosAssetsOptions, result: UploadCosAssetsResult): void {
  options.onProgress?.({
    processed: result.uploaded + result.skipped + result.failed,
    total: result.total,
    uploaded: result.uploaded,
    skipped: result.skipped,
    failed: result.failed,
  });
}

function toPutObjectParams(options: UploadCosAssetsOptions, item: CosUploadManifestItem): CosPutObjectParams {
  const sourcePath = join(options.manifest.source_base_dir, item.source_rel_path);
  const body = readFileSync(sourcePath);
  return {
    Bucket: options.bucket,
    Region: options.region,
    Key: item.object_key,
    Body: body,
    ContentLength: item.source_size,
    ContentType: item.content_type,
    "x-cos-meta-public-id": item.public_id,
    "x-cos-meta-product-id": item.product_id,
    "x-cos-meta-sha256": item.source_sha256,
    "x-cos-meta-access-tier": item.access_tier,
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
      throw new Error("Usage: tsx scripts/cos-asset-uploader.ts --manifest /private/cos-upload-manifest.private.json --bucket name-appid --region ap-guangzhou --secret-id ... --secret-key ... [--dry-run true] [--continue-on-error true]");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function createCosClient(secretId: string, secretKey: string): CosAssetUploadClient {
  const require = createRequire(import.meta.url);
  const COS = require("cos-nodejs-sdk-v5") as new (options: {
    SecretId: string;
    SecretKey: string;
  }) => {
    putObject(params: CosPutObjectParams, callback: (err: Error | null, data: unknown) => void): void;
  };
  const client = new COS({
    SecretId: secretId,
    SecretKey: secretKey,
  });
  return {
    putObject: (params) => new Promise((resolve, reject) => {
      client.putObject(params, (err, data) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(data);
      });
    }),
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const manifestPath = args.manifest;
  const bucket = args.bucket;
  const region = args.region;
  const secretId = args["secret-id"] ?? process.env.COS_SECRET_ID;
  const secretKey = args["secret-key"] ?? process.env.COS_SECRET_KEY;
  const dryRun = args["dry-run"] === "true";
  const progressEvery = Number(args["progress-every"] ?? 25);

  if (!manifestPath || !bucket || !region) {
    throw new Error("Missing required args: --manifest, --bucket, --region");
  }
  if (!dryRun && (!secretId || !secretKey)) {
    throw new Error("Missing COS credentials for non-dry-run upload");
  }

  const client = dryRun ? new DryRunCosAssetUploadClient() : createCosClient(requiredString(secretId), requiredString(secretKey));
  const result = await uploadCosAssets({
    client,
    bucket,
    region,
    manifest: readJson<CosUploadManifest>(manifestPath),
    dryRun,
    continueOnError: args["continue-on-error"] === "true",
    onProgress: (progress) => {
      if (progressEvery > 0 && (progress.processed % progressEvery === 0 || progress.processed === progress.total)) {
        console.error(JSON.stringify({ progress }));
      }
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.failed > 0) {
    process.exitCode = 1;
  }
}

class DryRunCosAssetUploadClient implements CosAssetUploadClient {
  async putObject(): Promise<unknown> {
    throw new Error("dry-run client must not upload");
  }
}

function requiredString(value: string | undefined): string {
  if (!value) {
    throw new Error("Missing required string");
  }
  return value;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
