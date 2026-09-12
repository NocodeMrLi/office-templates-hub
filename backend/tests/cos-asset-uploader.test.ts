import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import {
  uploadCosAssets,
  type CosAssetUploadClient,
} from "../../scripts/cos-asset-uploader.js";
import type { CosUploadManifest } from "../../scripts/cos-upload-manifest.js";

describe("uploadCosAssets", () => {
  test("uploads manifest files to COS with metadata and content type", async () => {
    const root = await mkdtemp(join(tmpdir(), "cos-asset-uploader-"));
    mkdirSync(join(root, "01-general"));
    const content = Buffer.from("xlsx bytes");
    writeFileSync(join(root, "01-general", "PMF-0001-变更表.xlsx"), content);
    const sourceSha256 = createHash("sha256").update(content).digest("hex");
    const calls: unknown[] = [];
    const client: CosAssetUploadClient = {
      putObject: async (params) => {
        calls.push({
          ...params,
          Body: Buffer.isBuffer(params.Body) ? params.Body.toString("utf8") : params.Body,
        });
      },
    };

    const result = await uploadCosAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest: makeManifest(root, sourceSha256, content.byteLength),
    });

    expect(result).toEqual({
      total: 1,
      uploaded: 1,
      skipped: 0,
      failed: 0,
      failures: [],
      dry_run: false,
    });
    expect(calls).toEqual([{
      Bucket: "office-templates-assets-1455917634",
      Region: "ap-guangzhou",
      Key: "templates/tpl_alpha.xlsx",
      Body: "xlsx bytes",
      ContentLength: content.byteLength,
      ContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "x-cos-meta-public-id": "tpl_alpha",
      "x-cos-meta-product-id": "PMF-0001",
      "x-cos-meta-sha256": sourceSha256,
      "x-cos-meta-access-tier": "free",
    }]);
  });

  test("dry-run verifies sources without uploading", async () => {
    const root = await mkdtemp(join(tmpdir(), "cos-asset-uploader-"));
    mkdirSync(join(root, "01-general"));
    const content = Buffer.from("xlsx bytes");
    writeFileSync(join(root, "01-general", "PMF-0001-变更表.xlsx"), content);
    const sourceSha256 = createHash("sha256").update(content).digest("hex");
    const calls: unknown[] = [];
    const client: CosAssetUploadClient = {
      putObject: async (params) => {
        calls.push(params);
      },
    };

    const result = await uploadCosAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest: makeManifest(root, sourceSha256, content.byteLength),
      dryRun: true,
    });

    expect(result).toMatchObject({
      total: 1,
      uploaded: 0,
      skipped: 1,
      failed: 0,
      dry_run: true,
    });
    expect(calls).toEqual([]);
  });

  test("fails before uploading when a source file hash does not match", async () => {
    const root = await mkdtemp(join(tmpdir(), "cos-asset-uploader-"));
    mkdirSync(join(root, "01-general"));
    const content = Buffer.from("changed bytes");
    writeFileSync(join(root, "01-general", "PMF-0001-变更表.xlsx"), content);
    const client: CosAssetUploadClient = {
      putObject: async () => {
        throw new Error("must not upload mismatched source");
      },
    };

    await expect(uploadCosAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest: makeManifest(root, "a".repeat(64), content.byteLength),
    })).rejects.toThrow("Source verification failed");
  });
});

function makeManifest(root: string, sourceSha256: string, sourceSize: number): CosUploadManifest {
  return {
    schema_version: "cos-upload-manifest/v1",
    source_schema_version: "3.2.0",
    source_base_dir: root,
    object_prefix: "templates/",
    count: 1,
    total_size_bytes: sourceSize,
    items: [{
      product_id: "PMF-0001",
      public_id: "tpl_alpha",
      display_name: "变更表",
      access_tier: "free",
      source_rel_path: "01-general/PMF-0001-变更表.xlsx",
      source_size: sourceSize,
      source_sha256: sourceSha256,
      object_key: "templates/tpl_alpha.xlsx",
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }],
  };
}
