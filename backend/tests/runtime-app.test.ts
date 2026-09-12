import { describe, expect, test } from "vitest";

import { createRuntimeApp } from "../src/runtime-app.js";

describe("createRuntimeApp", () => {
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
});
