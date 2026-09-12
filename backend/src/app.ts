import Fastify, { type FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";

import type { DeviceService } from "./domain/device-service.js";
import type { CatalogService } from "./domain/catalog-service.js";

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

export interface AppDependencies {
  deviceService: DeviceService;
  registrationResults: RegistrationResultStore;
  catalogService: CatalogService;
  health(): Promise<{ database: "ok" | "unavailable"; objectStorage: "ok" | "unavailable" | "not_configured" }>;
}

export function buildApp(dependencies: AppDependencies): FastifyInstance {
  const app = Fastify({ logger: false });

  app.get("/api/catalog", async (request, reply) => {
    const parsed = z.object({
      page: z.coerce.number().int().min(1).default(1),
      page_size: z.coerce.number().int().min(1).max(100).default(20),
      industry: z.string().min(1).optional(),
      access_tier: z.enum(["free", "paid"]).optional(),
    }).safeParse(request.query);
    if (!parsed.success) {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "目录筛选参数无效"));
    }
    return dependencies.catalogService.list({
      page: parsed.data.page,
      pageSize: parsed.data.page_size,
      ...(parsed.data.industry === undefined ? {} : { industry: parsed.data.industry }),
      ...(parsed.data.access_tier === undefined ? {} : { accessTier: parsed.data.access_tier }),
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

  app.post("/api/device/register", async (request, reply) => {
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string") {
      return reply.code(400).send(errorResponse("INVALID_PARAM", "缺少 Idempotency-Key 请求头"));
    }
    if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
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
