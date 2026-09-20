import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { createRuntimeApp } from "../src/runtime-app.js";
import type { CosGetObjectUrlClient } from "../src/infrastructure/cos-object-signer.js";

describe("createRuntimeApp", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  test("resolves spreadsheets from the configured active standard snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-runtime-standards-"));
    temporaryDirectories.push(directory);
    const standardsPath = join(directory, "standards.public.json");
    const snapshot = JSON.parse(await readFile("data/standards.public.json", "utf8")) as { version: string };
    snapshot.version = "9.9.9";
    await writeFile(standardsPath, `${JSON.stringify(snapshot)}\n`, "utf8");

    const app = await createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
      standardsPath,
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/spreadsheets/resolve",
      payload: {
        query: "做一份风险登记表",
        required_fields: ["新增验证字段", "另一个新增字段", "第三个新增字段"],
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      specification: { source: { standard_version: "9.9.9" } },
    });
    await app.close();
  });

  test("fails closed when the active standard snapshot schema is invalid", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-runtime-invalid-standards-"));
    temporaryDirectories.push(directory);
    const standardsPath = join(directory, "standards.public.json");
    const snapshot = JSON.parse(await readFile("data/standards.public.json", "utf8")) as { schema_version: string };
    snapshot.schema_version = "unknown-standard-schema";
    await writeFile(standardsPath, `${JSON.stringify(snapshot)}\n`, "utf8");

    await expect(createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
      standardsPath,
    })).rejects.toThrow();
  });

  test("fails closed when the active standard snapshot does not match the catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-runtime-mismatched-standards-"));
    temporaryDirectories.push(directory);
    const standardsPath = join(directory, "standards.public.json");
    const snapshot = JSON.parse(await readFile("data/standards.public.json", "utf8")) as {
      source_asset_count: number;
      standards: Array<{ source_asset_count: number }>;
    };
    snapshot.source_asset_count -= 1;
    if (!snapshot.standards[0] || snapshot.standards[0].source_asset_count <= 1) {
      throw new Error("test fixture requires a standard backed by multiple assets");
    }
    snapshot.standards[0].source_asset_count -= 1;
    await writeFile(standardsPath, `${JSON.stringify(snapshot)}\n`, "utf8");

    await expect(createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
      standardsPath,
    })).rejects.toThrow("active standard snapshot does not match catalog asset count");
  });

  test("reports object storage as configured when COS settings are present", async () => {
    const app = await createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
      cos: {
        secretId: "test-secret-id",
        secretKey: "test-secret-key",
        bucket: "office-templates-1250000000",
        region: "ap-shanghai",
      },
    });

    const health = await app.inject({ method: "GET", url: "/api/health" });

    expect(health.json()).toEqual({
      status: "ok",
      dependencies: { database: "ok", object_storage: "ok" },
    });
    expect(health.body).not.toContain("test-secret");
    await app.close();
  });

  test("loads the published catalog and serves searchable runtime endpoints", async () => {
    const app = await createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
    });

    const catalog = await app.inject({ method: "GET", url: "/api/catalog?page=1&page_size=1" });
    const search = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { query: "风险登记表", limit: 3 },
    });
    const health = await app.inject({ method: "GET", url: "/api/health" });

    expect(catalog.statusCode).toBe(200);
    expect(catalog.json().pagination.total_items).toBe(1319);
    expect(search.statusCode).toBe(200);
    expect(search.json()).toMatchObject({ usage_decrement_allowed: false });
    expect(health.json()).toEqual({
      status: "degraded",
      dependencies: { database: "ok", object_storage: "not_configured" },
    });
    await app.close();
  });

  test("registers devices but refuses downloads until object storage is configured", async () => {
    const app = await createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
    });
    const registration = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "runtime-register-1" },
    });
    const credentials = registration.json() as { device_id: string; device_secret: string };

    const download = await app.inject({
      method: "POST",
      url: "/api/download",
      headers: {
        "idempotency-key": "runtime-download-1",
        authorization: `Bearer ${credentials.device_secret}`,
      },
      payload: {
        device_id: credentials.device_id,
        public_id: "tpl_a2c994bc09c89d37",
      },
    });

    expect(registration.statusCode).toBe(201);
    expect(download.statusCode).toBe(503);
    expect(download.json()).toMatchObject({
      error: {
        code: "DEPENDENCY_UNAVAILABLE",
        message: "下载凭证签发失败",
      },
    });
    await app.close();
  });

  test("signs runtime downloads with the configured COS object prefix", async () => {
    const signedKeys: string[] = [];
    const cosClient: CosGetObjectUrlClient = {
      getObjectUrl: (params, callback) => {
        signedKeys.push(params.Key);
        callback(null, { Url: `https://signed.example/${params.Key}?sign=1` });
      },
    };
    const app = await createRuntimeApp({
      devicePepper: "runtime-device-pepper",
      codePepper: "runtime-code-pepper",
      recoveryPepper: "runtime-recovery-pepper",
      cos: {
        secretId: "test-secret-id",
        secretKey: "test-secret-key",
        bucket: "office-templates-assets-1455917634",
        region: "ap-guangzhou",
        objectPrefix: "templates/",
        client: cosClient,
      },
    });
    const registration = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "runtime-register-prefix" },
    });
    const credentials = registration.json() as { device_id: string; device_secret: string };

    const download = await app.inject({
      method: "POST",
      url: "/api/download",
      headers: {
        "idempotency-key": "runtime-download-prefix",
        authorization: `Bearer ${credentials.device_secret}`,
      },
      payload: {
        device_id: credentials.device_id,
        public_id: "tpl_a2c994bc09c89d37",
      },
    });

    expect(download.statusCode).toBe(200);
    expect(signedKeys).toEqual(["templates/tpl_a2c994bc09c89d37.xlsx"]);
    expect(download.json()).toMatchObject({
      public_id: "tpl_a2c994bc09c89d37",
      download_url: "https://signed.example/templates/tpl_a2c994bc09c89d37.xlsx?sign=1",
    });
    await app.close();
  });
});
