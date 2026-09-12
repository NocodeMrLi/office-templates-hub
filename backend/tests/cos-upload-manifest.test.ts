import { describe, expect, test } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import {
  buildCosUploadManifest,
  verifyCosUploadManifestSources,
} from "../../scripts/cos-upload-manifest.js";

describe("buildCosUploadManifest", () => {
  test("maps public catalog ids to private XLSX files and COS object keys", () => {
    const manifest = buildCosUploadManifest({
      catalog: {
        count: 2,
        items: [
          {
            product_id: "PMF-0001",
            public_id: "tpl_alpha",
            display_name: "变更表",
            access_tier: "free",
          },
          {
            product_id: "PMF-0002",
            public_id: "tpl_beta",
            display_name: "风险表",
            access_tier: "paid",
          },
        ],
      },
      finalManifest: {
        schema_version: "3.2.0",
        base_dir: "/private/assets",
        count: 2,
        files: [
          {
            rel_path: "01-general/PMF-0002-风险表.xlsx",
            size: 200,
            sha256: "b".repeat(64),
          },
          {
            rel_path: "01-general/PMF-0001-变更表.xlsx",
            size: 100,
            sha256: "a".repeat(64),
          },
        ],
      },
      objectPrefix: "/templates",
    });

    expect(manifest).toEqual({
      schema_version: "cos-upload-manifest/v1",
      source_schema_version: "3.2.0",
      source_base_dir: "/private/assets",
      object_prefix: "templates/",
      count: 2,
      total_size_bytes: 300,
      items: [
        {
          product_id: "PMF-0001",
          public_id: "tpl_alpha",
          display_name: "变更表",
          access_tier: "free",
          source_rel_path: "01-general/PMF-0001-变更表.xlsx",
          source_size: 100,
          source_sha256: "a".repeat(64),
          object_key: "templates/tpl_alpha.xlsx",
          content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
        {
          product_id: "PMF-0002",
          public_id: "tpl_beta",
          display_name: "风险表",
          access_tier: "paid",
          source_rel_path: "01-general/PMF-0002-风险表.xlsx",
          source_size: 200,
          source_sha256: "b".repeat(64),
          object_key: "templates/tpl_beta.xlsx",
          content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        },
      ],
    });
  });

  test("rejects missing final assets before upload", () => {
    expect(() => buildCosUploadManifest({
      catalog: {
        count: 1,
        items: [{
          product_id: "PMF-0001",
          public_id: "tpl_alpha",
          display_name: "变更表",
          access_tier: "free",
        }],
      },
      finalManifest: {
        schema_version: "3.2.0",
        base_dir: "/private/assets",
        count: 0,
        files: [],
      },
      objectPrefix: "templates/",
    })).toThrow("Missing final asset for product_id PMF-0001");
  });

  test("verifies source files exist and match the recorded sha256 before upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "cos-upload-manifest-"));
    mkdirSync(join(root, "01-general"));
    const content = Buffer.from("xlsx bytes");
    writeFileSync(join(root, "01-general", "PMF-0001-变更表.xlsx"), content);
    const sourceSha256 = createHash("sha256").update(content).digest("hex");
    const manifest = buildCosUploadManifest({
      catalog: {
        count: 1,
        items: [{
          product_id: "PMF-0001",
          public_id: "tpl_alpha",
          display_name: "变更表",
          access_tier: "free",
        }],
      },
      finalManifest: {
        schema_version: "3.2.0",
        base_dir: root,
        count: 1,
        files: [{
          rel_path: "01-general/PMF-0001-变更表.xlsx",
          size: content.byteLength,
          sha256: sourceSha256,
        }],
      },
      objectPrefix: "templates/",
    });

    expect(verifyCosUploadManifestSources(manifest)).toEqual({
      checked: 1,
      missing: [],
      mismatched: [],
    });
  });
});
