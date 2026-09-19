import { describe, expect, test } from "vitest";
import { createHash } from "node:crypto";

import {
  verifyCosUploadedAssets,
  type CosUploadedAssetVerifierClient,
} from "../../scripts/cos-upload-verifier.js";
import type { CosUploadManifest } from "../../scripts/cos-upload-manifest.js";

describe("verifyCosUploadedAssets", () => {
  test("passes when COS object metadata matches the private upload manifest", async () => {
    const calls: unknown[] = [];
    const client: CosUploadedAssetVerifierClient = {
      headObject: async (params) => {
        calls.push(params);
        return {
          headers: {
            "content-length": "10",
            "x-cos-meta-sha256": "a".repeat(64),
            "x-cos-meta-public-id": "tpl_alpha",
            "x-cos-meta-product-id": "PMF-0001",
          },
        };
      },
    };

    const result = await verifyCosUploadedAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest: makeManifest(),
    });

    expect(result).toEqual({
      total: 1,
      verified: 1,
      missing: 0,
      unauthorized: 0,
      unavailable: 0,
      mismatched: 0,
      failures: [],
    });
    expect(calls).toEqual([{
      Bucket: "office-templates-assets-1455917634",
      Region: "ap-guangzhou",
      Key: "templates/tpl_alpha.xlsx",
    }]);
  });

  test("reports not-found and mismatched objects without leaking local paths", async () => {
    const client: CosUploadedAssetVerifierClient = {
      headObject: async (params) => {
        if (params.Key === "templates/tpl_alpha.xlsx") {
          throw Object.assign(new Error("not found /private/source/path.xlsx"), { statusCode: 404, code: "NoSuchKey" });
        }
        return {
          headers: {
            "content-length": "9",
            "x-cos-meta-sha256": "b".repeat(64),
            "x-cos-meta-public-id": "tpl_beta",
            "x-cos-meta-product-id": "PMF-0002",
          },
        };
      },
    };
    const manifest = makeManifest();
    manifest.items.push({
      product_id: "PMF-0002",
      public_id: "tpl_beta",
      display_name: "风险表",
      access_tier: "paid",
      source_rel_path: "01-general/PMF-0002-风险表.xlsx",
      source_size: 10,
      source_sha256: "a".repeat(64),
      object_key: "templates/tpl_beta.xlsx",
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    manifest.count = 2;

    const result = await verifyCosUploadedAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest,
    });

    expect(result).toEqual({
      total: 2,
      verified: 0,
      missing: 1,
      unauthorized: 0,
      unavailable: 0,
      mismatched: 1,
      failures: [
        {
          object_key: "templates/tpl_alpha.xlsx",
          public_id: "tpl_alpha",
          reason: "not_found",
          details: "COS object not found",
        },
        {
          object_key: "templates/tpl_beta.xlsx",
          public_id: "tpl_beta",
          reason: "metadata_mismatch",
          details: "size expected 10 got 9; sha256 metadata mismatch",
        },
      ],
    });
  });

  test("classifies 403 as unauthorized rather than missing and sanitizes details", async () => {
    const client: CosUploadedAssetVerifierClient = {
      headObject: async () => {
        throw Object.assign(new Error("denied secret=/private/path"), { statusCode: 403, code: "AccessDenied" });
      },
    };

    const result = await verifyCosUploadedAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest: makeManifest(),
    });

    expect(result).toMatchObject({
      total: 1,
      verified: 0,
      missing: 0,
      unauthorized: 1,
      unavailable: 0,
      mismatched: 0,
      failures: [{ reason: "unauthorized", details: "COS authorization failed" }],
    });
    expect(JSON.stringify(result)).not.toContain("secret=");
    expect(JSON.stringify(result)).not.toContain("/private/path");
  });

  test("falls back to read-only object content verification when HeadObject is forbidden", async () => {
    const body = Buffer.from("0123456789");
    const manifest = makeManifest();
    manifest.items[0]!.source_sha256 = createHash("sha256").update(body).digest("hex");
    const client: CosUploadedAssetVerifierClient = {
      headObject: async () => {
        throw Object.assign(new Error("denied"), { statusCode: 403, code: "AccessDenied" });
      },
      getObject: async () => ({ Body: body }),
    };

    const result = await verifyCosUploadedAssets({
      client,
      bucket: "office-templates-assets-1455917634",
      region: "ap-guangzhou",
      manifest,
    });

    expect(result).toMatchObject({
      total: 1,
      verified: 1,
      missing: 0,
      unauthorized: 0,
      unavailable: 0,
      mismatched: 0,
      failures: [],
    });
  });
});

function makeManifest(): CosUploadManifest {
  return {
    schema_version: "cos-upload-manifest/v1",
    source_schema_version: "3.2.0",
    source_base_dir: "/private/assets",
    object_prefix: "templates/",
    count: 1,
    total_size_bytes: 10,
    items: [{
      product_id: "PMF-0001",
      public_id: "tpl_alpha",
      display_name: "变更表",
      access_tier: "free",
      source_rel_path: "01-general/PMF-0001-变更表.xlsx",
      source_size: 10,
      source_sha256: "a".repeat(64),
      object_key: "templates/tpl_alpha.xlsx",
      content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }],
  };
}
