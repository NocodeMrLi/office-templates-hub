import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { DeviceService } from "./domain/device-service.js";
import type { CatalogService } from "./domain/catalog-service.js";
import type { SearchService } from "./domain/search-service.js";
import type { OfficeSpreadsheetEngine } from "./domain/office-spreadsheet-engine.js";

interface RegistrationCredentials {
  deviceId: string;
  deviceSecret: string;
}

export interface RegistrationResultStore {
  getOrCreate(
    key: string,
    create: () => Promise<RegistrationCredentials>,
  ): Promise<RegistrationCredentials>;
}

export interface DownloadServicePort {
  download(request: {
    deviceId: string;
    deviceSecret: string;
    idempotencyKey: string;
    publicId: string;
  }): Promise<{
    public_id: string;
    download_url: string;
    expires_at: string;
    sha256: string;
    quota_remaining: null;
    quota_applied: false;
  }>;
}

export interface RedeemServicePort {
  redeem(request: {
    deviceId: string;
    code: string;
  }): Promise<{
    entitlement: string;
    daily_limit: number;
    expires_at: string;
  }>;
}

export interface RecoveryServicePort {
  recover(request: {
    deviceId: string;
    recoveryCode: string;
  }): Promise<{
    device_id: string;
    device_secret: string;
    recovery_code: string;
  }>;
}

export interface AppDependencies {
  deviceService: DeviceService;
  registrationResults: RegistrationResultStore;
  catalogService: CatalogService;
  searchService: SearchService;
  spreadsheetEngine: OfficeSpreadsheetEngine;
  downloadService: DownloadServicePort;
  redeemService: RedeemServicePort;
  recoveryService: RecoveryServicePort;
  health(): Promise<{ database: "ok" | "unavailable"; objectStorage: "ok" | "unavailable" | "not_configured" }>;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/catalog", async (request, reply) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
      industry: z.string().min(1).optional(),
      asset_scope: z.literal("public").optional(),
    }).strict().safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "目录筛选参数无效"));
    }
    return dependencies.catalogService.list({
      page: parsed.data.page,
      pageSize: parsed.data.page_size,
      ...(parsed.data.industry === undefined ? {} : { industry: parsed.data.industry }),
    });
  });

  app.get("/api/health", async () => {
    const health = await dependencies.health();
    return {
      status: health.database === "ok" && health.objectStorage === "ok" ? "ok" : "degraded",
      dependencies: {
        database: health.database,
        object_storage: health.objectStorage,
      },
    };
  });

  app.post("/api/search", async (request, reply) => {
    const parsed = z.object({
      query: z.string().trim().min(1).max(200),
      limit: z.number().int().min(1).max(10).default(3),
      industry: z.string().min(1).optional(),
      asset_scope: z.literal("public").optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "搜索参数无效"));
    }
    return dependencies.searchService.search({
      query: parsed.data.query,
      limit: parsed.data.limit,
      ...(parsed.data.industry === undefined ? {} : { industry: parsed.data.industry }),
    });
  });

  app.post("/api/spreadsheets/resolve", async (request, reply) => {
    const parsed = z.object({
      query: z.string().trim().min(1).max(500),
      industry: z.string().trim().min(1).max(100).optional(),
      required_fields: z.array(z.string().trim().min(1).max(100)).max(100).optional(),
      roles: z.array(z.string().trim().min(1).max(100)).max(30).optional(),
      regulated: z.boolean().optional(),
      allow_draft: z.boolean().optional(),
    }).strict().safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "表格需求参数无效"));
    }
    return dependencies.spreadsheetEngine.resolve({
      query: parsed.data.query,
      ...(parsed.data.industry === undefined ? {} : { industry: parsed.data.industry }),
      ...(parsed.data.required_fields === undefined ? {} : { requiredFields: parsed.data.required_fields }),
      ...(parsed.data.roles === undefined ? {} : { roles: parsed.data.roles }),
      ...(parsed.data.regulated === undefined ? {} : { regulated: parsed.data.regulated }),
      ...(parsed.data.allow_draft === undefined ? {} : { allowDraft: parsed.data.allow_draft }),
    });
  });

  app.post("/api/download", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !isValidIdempotencyKey(key)) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "Idempotency-Key 格式无效"));
    }
    const deviceSecret = parseBearerSecret(request.headers.authorization);
    if (!deviceSecret) {
      return reply.code(401).send(errorResponse("UNAUTHORIZED_DEVICE", "设备凭证无效"));
    }

    const parsed = z.object({
      device_id: z.string().min(1).max(128),
      public_id: z.string().min(1).max(128),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "下载参数无效"));
    }

    try {
      return await dependencies.downloadService.download({
        deviceId: parsed.data.device_id,
        deviceSecret,
        idempotencyKey: key,
        publicId: parsed.data.public_id,
      });
    } catch (error) {
      const mapped = mapDownloadError(error);
      return reply.code(mapped.status).send(errorResponse(mapped.code, mapped.message));
    }
  });

  app.post("/api/redeem", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !isValidIdempotencyKey(key)) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "Idempotency-Key 格式无效"));
    }
    const deviceSecret = parseBearerSecret(request.headers.authorization);
    if (!deviceSecret) {
      return reply.code(401).send(errorResponse("UNAUTHORIZED_DEVICE", "设备凭证无效"));
    }

    const parsed = z.object({
      device_id: z.string().min(1).max(128),
      code: z.string().min(1).max(256),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "兑换参数无效"));
    }

    try {
      await dependencies.deviceService.authenticate(parsed.data.device_id, deviceSecret);
      return await dependencies.redeemService.redeem({
        deviceId: parsed.data.device_id,
        code: parsed.data.code,
      });
    } catch (error) {
      const mapped = mapRedeemError(error);
      return reply.code(mapped.status).send(errorResponse(mapped.code, mapped.message));
    }
  });

  app.post("/api/recover", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !isValidIdempotencyKey(key)) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "Idempotency-Key 格式无效"));
    }

    const parsed = z.object({
      device_id: z.string().min(1).max(128),
      recovery_code: z.string().min(1).max(256),
    }).safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "恢复参数无效"));
    }

    try {
      return await dependencies.recoveryService.recover({
        deviceId: parsed.data.device_id,
        recoveryCode: parsed.data.recovery_code,
      });
    } catch (error) {
      const mapped = mapRecoveryError(error);
      return reply.code(mapped.status).send(errorResponse(mapped.code, mapped.message));
    }
  });

  app.post("/api/device/register", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string") {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "缺少 Idempotency-Key 请求头"));
    }
    if (!isValidIdempotencyKey(key)) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "Idempotency-Key 格式无效"));
    }

    const credentials = await dependencies.registrationResults.getOrCreate(key, () =>
      dependencies.deviceService.register(),
    );
    return reply.code(201).send({
      device_id: credentials.deviceId,
      device_secret: credentials.deviceSecret,
    });
  });

  return app;
}

function errorResponse(code: string, message: string) {
  return { error: { code, message, request_id: randomUUID() } };
}

function isValidIdempotencyKey(key: string): boolean {
  return /^[A-Za-z0-9._:-]{8,128}$/.test(key);
}

function parseBearerSecret(value: string | undefined): string | null {
  if (!value?.startsWith("Bearer ")) {
    return null;
  }
  const secret = value.slice("Bearer ".length).trim();
  return secret.length > 0 ? secret : null;
}

function mapDownloadError(error: unknown): { status: number; code: string; message: string } {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "IDEMPOTENCY_CONFLICT") {
      return { status: 409, code, message: "同一幂等键的请求参数不一致" };
    }
    if (code === "FORBIDDEN_ASSET") {
      return { status: 403, code, message: "当前设备无权下载该资产" };
    }
    if (code === "TEMPLATE_NOT_FOUND") {
      return { status: 404, code, message: "模板不存在或不可用" };
    }
    if (code === "DEPENDENCY_UNAVAILABLE") {
      return { status: 503, code, message: "下载凭证签发失败" };
    }
    if (code === "QUOTA_EXHAUSTED") {
      return { status: 429, code, message: "今日下载额度已用完" };
    }
    if (code === "UNAUTHORIZED_DEVICE") {
      return { status: 401, code, message: "设备凭证无效" };
    }
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "服务暂时不可用" };
}

function mapRedeemError(error: unknown): { status: number; code: string; message: string } {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "INVALID_REDEEM_CODE") {
      return { status: 400, code, message: "兑换码无效或已失效" };
    }
    if (code === "UNAUTHORIZED_DEVICE") {
      return { status: 401, code, message: "设备凭证无效" };
    }
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "服务暂时不可用" };
}

function mapRecoveryError(error: unknown): { status: number; code: string; message: string } {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = String(error.code);
    if (code === "INVALID_RECOVERY_CODE") {
      return { status: 400, code, message: "恢复码无效或已失效" };
    }
  }
  return { status: 500, code: "INTERNAL_ERROR", message: "服务暂时不可用" };
}
