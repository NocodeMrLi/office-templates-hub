import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import type { CosUploadManifest, CosUploadManifestItem } from "./cos-upload-manifest.js";

export interface CosHeadObjectParams {
  Bucket: string;
  Region: string;
  Key: string;
}

export interface CosHeadObjectResult {
  headers?: Record<string, string | number | undefined>;
}

export interface CosUploadedAssetVerifierClient {
  headObject(params: CosHeadObjectParams): Promise<CosHeadObjectResult>;
}

export interface VerifyCosUploadedAssetsOptions {
  client: CosUploadedAssetVerifierClient;
  bucket: string;
  region: string;
  manifest: CosUploadManifest;
  continueOnError?: boolean;
  onProgress?: (progress: { processed: number; total: number; verified: number; missing: number; mismatched: number }) => void;
}

export interface VerifyCosUploadedAssetsResult {
  total: number;
  verified: number;
  missing: number;
  mismatched: number;
  failures: Array<{
    object_key: string;
    public_id: string;
    reason: "missing" | "metadata_mismatch";
    details: string;
  }>;
}

export async function verifyCosUploadedAssets(
  options: VerifyCosUploadedAssetsOptions,
): Promise<VerifyCosUploadedAssetsResult> {
  const result: VerifyCosUploadedAssetsResult = {
    total: options.manifest.items.length,
    verified: 0,
    missing: 0,
    mismatched: 0,
    failures: [],
  };

  for (const item of options.manifest.items) {
    try {
      const head = await options.client.headObject({
        Bucket: options.bucket,
        Region: options.region,
        Key: item.object_key,
      });
      const mismatchDetails = metadataMismatchDetails(item, head.headers ?? {});
      if (mismatchDetails.length > 0) {
        result.mismatched += 1;
        result.failures.push({
          object_key: item.object_key,
          public_id: item.public_id,
          reason: "metadata_mismatch",
          details: mismatchDetails.join("; "),
        });
        if (!options.continueOnError) continue;
      } else {
        result.verified += 1;
      }
    } catch {
      result.missing += 1;
      result.failures.push({
        object_key: item.object_key,
        public_id: item.public_id,
        reason: "missing",
        details: "headObject failed",
      });
      if (!options.continueOnError) continue;
    }
    emitProgress(options, result);
  }

  return result;
}

function emitProgress(options: VerifyCosUploadedAssetsOptions, result: VerifyCosUploadedAssetsResult): void {
  options.onProgress?.({
    processed: result.verified + result.missing + result.mismatched,
    total: result.total,
    verified: result.verified,
    missing: result.missing,
    mismatched: result.mismatched,
  });
}

function metadataMismatchDetails(item: CosUploadManifestItem, headers: Record<string, string | number | undefined>): string[] {
  const details: string[] = [];
  const actualSize = Number(headers["content-length"]);
  if (actualSize !== item.source_size) {
    details.push(`size expected ${item.source_size} got ${Number.isNaN(actualSize) ? "missing" : actualSize}`);
  }
  if (headers["x-cos-meta-sha256"] !== item.source_sha256) {
    details.push("sha256 metadata mismatch");
  }
  if (headers["x-cos-meta-public-id"] !== item.public_id) {
    details.push("public_id metadata mismatch");
  }
  if (headers["x-cos-meta-product-id"] !== item.product_id) {
    details.push("product_id metadata mismatch");
  }
  return details;
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
      throw new Error("Usage: tsx scripts/cos-upload-verifier.ts --manifest /private/cos-upload-manifest.private.json --bucket name-appid --region ap-guangzhou --secret-id ... --secret-key ...");
    }
    args[key.slice(2)] = value;
  }
  return args;
}

function createCosClient(secretId: string, secretKey: string): CosUploadedAssetVerifierClient {
  const require = createRequire(import.meta.url);
  const COS = require("cos-nodejs-sdk-v5") as new (options: {
    SecretId: string;
    SecretKey: string;
  }) => {
    headObject(params: CosHeadObjectParams, callback: (err: Error | null, data: CosHeadObjectResult) => void): void;
  };
  const client = new COS({
    SecretId: secretId,
    SecretKey: secretKey,
  });
  return {
    headObject: (params) => new Promise((resolve, reject) => {
      client.headObject(params, (err, data) => {
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
  const progressEvery = Number(args["progress-every"] ?? 25);
  if (!manifestPath || !bucket || !region || !secretId || !secretKey) {
    throw new Error("Missing required args: --manifest, --bucket, --region, and COS credentials");
  }

  const result = await verifyCosUploadedAssets({
    client: createCosClient(secretId, secretKey),
    bucket,
    region,
    manifest: readJson<CosUploadManifest>(manifestPath),
    continueOnError: true,
    onProgress: (progress) => {
      if (progressEvery > 0 && (progress.processed % progressEvery === 0 || progress.processed === progress.total)) {
        console.error(JSON.stringify({ progress }));
      }
    },
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.missing > 0 || result.mismatched > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
