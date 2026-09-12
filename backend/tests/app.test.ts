import { describe, expect, test } from "vitest";

import { buildApp, type RegistrationResultStore } from "../src/app.js";
import { CatalogService } from "../src/domain/catalog-service.js";
import { DeviceService, type DeviceRecord, type DeviceRepository } from "../src/domain/device-service.js";
import { SearchService } from "../src/domain/search-service.js";

class TestDeviceRepository implements DeviceRepository {
  readonly records = new Map<string, DeviceRecord>();

  async create(record: DeviceRecord): Promise<void> {
    this.records.set(record.deviceId, structuredClone(record));
  }

  async findById(deviceId: string): Promise<DeviceRecord | null> {
    return structuredClone(this.records.get(deviceId) ?? null);
  }

  async replaceSecret(deviceId: string, secretDigest: string, rotatedAt: Date): Promise<void> {
    const current = this.records.get(deviceId);
    if (!current) throw new Error("device missing");
    this.records.set(deviceId, { ...current, secretDigest, rotatedAt });
  }
}

class TestRegistrationResultStore implements RegistrationResultStore {
  readonly results = new Map<string, { deviceId: string; deviceSecret: string }>();
  readonly inflight = new Map<string, Promise<{ deviceId: string; deviceSecret: string }>>();

  async getOrCreate(
    key: string,
    create: () => Promise<{ deviceId: string; deviceSecret: string }>,
  ): Promise<{ deviceId: string; deviceSecret: string }> {
    const current = this.results.get(key);
    if (current) return current;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const next = create().then((result) => {
      this.results.set(key, result);
      this.inflight.delete(key);
      return result;
    });
    this.inflight.set(key, next);
    return next;
  }
}

function createTestApp() {
  const devices = new TestDeviceRepository();
  const registrations = new TestRegistrationResultStore();
  const searchTemplates = [{
    public_id: "tpl_alpha000000001",
    display_name: "项目风险登记表（标准版）",
    canonical_title: "项目风险登记表",
    intent: "risk_register",
    intent_name: "风险登记",
    industry: "通用项目管理",
    project_phase: "执行",
    roles: ["项目经理"],
    purpose: "记录风险",
    output: "风险台账",
    field_names: ["风险事项", "责任人"],
    access_tier: "free" as const,
  }];
  const app = buildApp({
    deviceService: new DeviceService(devices, "test-device-pepper"),
    registrationResults: registrations,
    catalogService: CatalogService.fromUnknown({
      count: 1,
      items: [{
        product_id: "PMF-0001",
        public_id: "tpl_alpha000000001",
        display_name: "项目风险登记表（标准版）",
        canonical_title: "项目风险登记表",
        intent: "risk_register",
        intent_name: "风险登记",
        industry: "通用项目管理",
        project_phase: "执行",
        roles: ["项目经理"],
        purpose: "记录风险",
        output: "风险台账",
        field_names: ["风险事项", "责任人"],
        variant: "standard",
        variant_label: "标准版",
        audience: "项目团队",
        scale_label: "单项目",
        complexity: "标准",
        information_density: "中",
        regulated: false,
        data_sensitivity: "一般",
        compliance_review: "启用前确认",
        access_tier: "free",
        quality_tier: "product_pass",
        rights_status: "PASS_INDEPENDENT_REBUILD",
        object_tags: [],
      }],
    }),
    searchService: new SearchService(searchTemplates),
    downloadService: {
      download: async (request) => ({
        public_id: request.publicId,
        download_url: "https://signed.example/download",
        expires_at: "2026-09-12T10:05:00.000Z",
        sha256: "sha-free",
        quota_remaining: 4,
      }),
    },
    redeemService: {
      redeem: async (request) => {
        if (request.code !== "AF-ORDER-001-CODE") {
          const error = new Error("兑换码无效或已失效") as Error & { code: string };
          error.code = "INVALID_REDEEM_CODE";
          throw error;
        }
        return {
          entitlement: "afdian_month",
          daily_limit: 30,
          expires_at: "2026-10-12T02:00:00.000Z",
        };
      },
    },
    health: async () => ({ database: "ok", objectStorage: "not_configured" }),
  });
  return { app, devices };
}

describe("HTTP API", () => {
  test("returns the documented error envelope when a write lacks Idempotency-Key", async () => {
    const { app } = createTestApp();

    const response = await app.inject({ method: "POST", url: "/api/device/register" });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_PARAM",
        message: "缺少 Idempotency-Key 请求头",
      },
    });
    expect(response.json().error.request_id).toMatch(/^[0-9a-f-]{36}$/);
    await app.close();
  });

  test("replays the same registration result for the same idempotency key", async () => {
    const { app, devices } = createTestApp();
    const request = {
      method: "POST" as const,
      url: "/api/device/register",
      headers: { "idempotency-key": "register-device-0001" },
    };

    const first = await app.inject(request);
    const second = await app.inject(request);

    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(first.json()).toMatchObject({
      device_id: expect.any(String),
      device_secret: expect.stringMatching(/^[A-Za-z0-9_-]{43}$/),
    });
    expect(devices.records.size).toBe(1);
    await app.close();
  });

  test("reports dependency health without exposing configuration", async () => {
    const { app } = createTestApp();

    const response = await app.inject({ method: "GET", url: "/api/health" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: "degraded",
      dependencies: { database: "ok", object_storage: "not_configured" },
    });
    expect(response.body).not.toContain("pepper");
    await app.close();
  });

  test("serves a paginated public catalog", async () => {
    const { app } = createTestApp();

    const response = await app.inject({ method: "GET", url: "/api/catalog?page=1&page_size=1" });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      items: [{ public_id: "tpl_alpha000000001", access_tier: "free" }],
      pagination: { page: 1, page_size: 1, total_items: 1, total_pages: 1 },
    });
    await app.close();
  });

  test("coalesces concurrent registration retries into one device", async () => {
    const { app, devices } = createTestApp();
    const responses = await Promise.all(
      Array.from({ length: 20 }, () =>
        app.inject({
          method: "POST",
          url: "/api/device/register",
          headers: { "idempotency-key": "register-device-concurrent" },
        }),
      ),
    );

    expect(new Set(responses.map((response) => response.body)).size).toBe(1);
    expect(devices.records.size).toBe(1);
    await app.close();
  });

  test("searches templates without decrementing usage", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { query: "项目风险登记表", limit: 1 },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      usage_decrement_allowed: false,
      decision: "recommend",
      top_result: {
        public_id: "tpl_alpha000000001",
        access_tier: "free",
      },
    });
    await app.close();
  });

  test("rejects malformed search requests with the documented error envelope", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/search",
      payload: { query: "", limit: 1 },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_PARAM",
        message: "搜索参数无效",
      },
    });
    await app.close();
  });

  test("downloads through POST with idempotency and bearer device secret", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/download",
      headers: {
        "idempotency-key": "download-idempotent-1",
        authorization: "Bearer secret-1",
      },
      payload: {
        device_id: "device-1",
        public_id: "tpl_alpha000000001",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      public_id: "tpl_alpha000000001",
      download_url: "https://signed.example/download",
      expires_at: "2026-09-12T10:05:00.000Z",
      sha256: "sha-free",
      quota_remaining: 4,
    });
    await app.close();
  });

  test("rejects download requests without a bearer device secret", async () => {
    const { app } = createTestApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/download",
      headers: { "idempotency-key": "download-idempotent-1" },
      payload: {
        device_id: "device-1",
        public_id: "tpl_alpha000000001",
      },
    });

    expect(response.statusCode).toBe(401);
    expect(response.json()).toMatchObject({
      error: {
        code: "UNAUTHORIZED_DEVICE",
        message: "设备凭证无效",
      },
    });
    await app.close();
  });

  test("redeems an Afdian code with idempotency and bearer device secret", async () => {
    const { app } = createTestApp();
    const registration = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "register-before-redeem-1" },
    });
    const credentials = registration.json() as { device_id: string; device_secret: string };

    const response = await app.inject({
      method: "POST",
      url: "/api/redeem",
      headers: {
        "idempotency-key": "redeem-idempotent-1",
        authorization: `Bearer ${credentials.device_secret}`,
      },
      payload: {
        device_id: credentials.device_id,
        code: "AF-ORDER-001-CODE",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      entitlement: "afdian_month",
      daily_limit: 30,
      expires_at: "2026-10-12T02:00:00.000Z",
    });
    await app.close();
  });

  test("returns a safe error envelope for an invalid redeem code", async () => {
    const { app } = createTestApp();
    const registration = await app.inject({
      method: "POST",
      url: "/api/device/register",
      headers: { "idempotency-key": "register-before-redeem-2" },
    });
    const credentials = registration.json() as { device_id: string; device_secret: string };

    const response = await app.inject({
      method: "POST",
      url: "/api/redeem",
      headers: {
        "idempotency-key": "redeem-idempotent-1",
        authorization: `Bearer ${credentials.device_secret}`,
      },
      payload: {
        device_id: credentials.device_id,
        code: "WRONG-CODE",
      },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: {
        code: "INVALID_REDEEM_CODE",
        message: "兑换码无效或已失效",
      },
    });
    expect(response.body).not.toContain("WRONG-CODE");
    await app.close();
  });
});
