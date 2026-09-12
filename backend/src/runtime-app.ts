import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import { buildApp, type RegistrationResultStore } from "./app.js";
import { CatalogService, type PublicTemplate } from "./domain/catalog-service.js";
import { DeviceService, type DeviceRecord, type DeviceRepository } from "./domain/device-service.js";
import {
  DownloadService,
  type DownloadEntitlementRepository,
  type DownloadEvent,
  type DownloadEventRepository,
  type DownloadQuotaService,
  type DownloadTemplate,
  type DownloadTemplateRepository,
  type ObjectSigner,
} from "./domain/download-service.js";
import {
  RecoveryService,
  type RecoveryCodeRecord,
  type RecoveryCodeRepository,
} from "./domain/recovery-service.js";
import { RedeemService, type CodeRecord, type CodeRepository } from "./domain/redeem-service.js";
import { SearchService } from "./domain/search-service.js";
import { UsageQuotaService, type EntitlementRecord, type UsageQuotaRepository } from "./domain/usage-quota-service.js";

export interface RuntimeAppOptions {
  catalogPath?: string;
  devicePepper: string;
  codePepper: string;
  recoveryPepper: string;
}

interface CatalogSource {
  count: number;
  items: PublicTemplate[];
}

export async function createRuntimeApp(options: RuntimeAppOptions) {
  const catalogSource = readCatalog(options.catalogPath);
  const devices = new InMemoryDeviceRepository();
  const entitlements = new InMemoryEntitlementRepository();
  const usage = new InMemoryUsageQuotaRepository(entitlements);
  const recoveryCodes = new InMemoryRecoveryCodeRepository();
  const codeRepository = new InMemoryCodeRepository();
  const downloadEvents = new InMemoryDownloadEventRepository();
  const catalogService = CatalogService.fromUnknown(catalogSource);
  const deviceService = new DeviceService(devices, options.devicePepper);
  const usageQuotaService = new UsageQuotaService(usage);
  const templateRepository = new CatalogBackedDownloadTemplateRepository(catalogSource.items);

  return buildApp({
    deviceService,
    registrationResults: new InMemoryRegistrationResultStore(),
    catalogService,
    searchService: new SearchService(catalogSource.items),
    downloadService: new DownloadService({
      authenticator: {
        authenticate: async (deviceId, secret) => {
          await deviceService.authenticate(deviceId, secret);
        },
      },
      templateRepository,
      entitlements,
      quota: new InMemoryDownloadQuotaService(entitlements),
      events: downloadEvents,
      signer: new NotConfiguredObjectSigner(),
    }),
    redeemService: new RedeemService(codeRepository, usageQuotaService, options.codePepper),
    recoveryService: new RecoveryService({
      devices,
      recoveryCodes,
      devicePepper: options.devicePepper,
      recoveryPepper: options.recoveryPepper,
    }),
    health: async () => ({ database: "ok", objectStorage: "not_configured" }),
  });
}

function readCatalog(path = fileURLToPath(new URL("../../data/catalog.public.json", import.meta.url))): CatalogSource {
  return JSON.parse(readFileSync(path, "utf8")) as CatalogSource;
}

class InMemoryDeviceRepository implements DeviceRepository {
  private readonly records = new Map<string, DeviceRecord>();

  async create(record: DeviceRecord): Promise<void> {
    this.records.set(record.deviceId, structuredClone(record));
  }

  async findById(deviceId: string): Promise<DeviceRecord | null> {
    return structuredClone(this.records.get(deviceId) ?? null);
  }

  async replaceSecret(deviceId: string, secretDigest: string, rotatedAt: Date): Promise<void> {
    const current = this.records.get(deviceId);
    if (!current) {
      throw new Error("device missing");
    }
    this.records.set(deviceId, { ...current, secretDigest, rotatedAt });
  }
}

class InMemoryRegistrationResultStore implements RegistrationResultStore {
  private readonly results = new Map<string, { deviceId: string; deviceSecret: string }>();
  private readonly inflight = new Map<string, Promise<{ deviceId: string; deviceSecret: string }>>();

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

class InMemoryEntitlementRepository implements DownloadEntitlementRepository {
  readonly entitlements: EntitlementRecord[] = [];

  async hasPaidAccess(deviceId: string, at: Date): Promise<boolean> {
    return (await this.findActiveEntitlement(deviceId, at)) !== null;
  }

  async findActiveEntitlement(deviceId: string, at: Date): Promise<EntitlementRecord | null> {
    return this.entitlements.find((record) =>
      record.deviceId === deviceId
      && record.startsAt.getTime() <= at.getTime()
      && record.expiresAt.getTime() > at.getTime()
    ) ?? null;
  }
}

class InMemoryUsageQuotaRepository implements UsageQuotaRepository {
  private readonly usage = new Map<string, number>();

  constructor(private readonly entitlementRepository: InMemoryEntitlementRepository) {}

  async createEntitlement(record: EntitlementRecord): Promise<void> {
    this.entitlementRepository.entitlements.push(structuredClone(record));
  }

  async findActiveEntitlement(deviceId: string, at: Date): Promise<EntitlementRecord | null> {
    return this.entitlementRepository.findActiveEntitlement(deviceId, at);
  }

  async consumeDaily(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }> {
    const key = `${deviceId}:${date}`;
    const current = this.usage.get(key) ?? 0;
    if (current >= limit) {
      return { allowed: false, used: current };
    }
    const next = current + 1;
    this.usage.set(key, next);
    return { allowed: true, used: next };
  }
}

class InMemoryDownloadQuotaService implements DownloadQuotaService {
  private readonly deliveredDaily = new Map<string, number>();
  private readonly reservations = new Map<string, { deviceId: string; day: string; remainingAfterDelivery: number }>();

  constructor(private readonly entitlements: InMemoryEntitlementRepository) {}

  async reserve(deviceId: string, at: Date): Promise<{ reservationId: string; remainingAfterDelivery: number }> {
    const day = chinaDayKey(at);
    const used = this.deliveredDaily.get(`${deviceId}:${day}`) ?? 0;
    const limit = (await this.entitlements.hasPaidAccess(deviceId, at)) ? 30 : 5;
    if (used >= limit) {
      const error = new Error("quota exhausted") as Error & { code: string };
      error.code = "QUOTA_EXHAUSTED";
      throw error;
    }
    const reservationId = randomUUID();
    this.reservations.set(reservationId, {
      deviceId,
      day,
      remainingAfterDelivery: Math.max(limit - used - 1, 0),
    });
    return { reservationId, remainingAfterDelivery: Math.max(limit - used - 1, 0) };
  }

  async commit(reservationId: string): Promise<void> {
    const reservation = this.reservations.get(reservationId);
    if (reservation) {
      const key = `${reservation.deviceId}:${reservation.day}`;
      this.deliveredDaily.set(key, (this.deliveredDaily.get(key) ?? 0) + 1);
    }
    this.reservations.delete(reservationId);
  }

  async release(reservationId: string): Promise<void> {
    this.reservations.delete(reservationId);
  }
}

function chinaDayKey(date: Date): string {
  const local = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  return [
    local.getUTCFullYear(),
    String(local.getUTCMonth() + 1).padStart(2, "0"),
    String(local.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

class CatalogBackedDownloadTemplateRepository implements DownloadTemplateRepository {
  private readonly templates: Map<string, DownloadTemplate>;

  constructor(items: readonly PublicTemplate[]) {
    this.templates = new Map(items.map((item) => [item.public_id, {
      publicId: item.public_id,
      accessTier: item.access_tier,
      objectKey: `not-configured/${item.public_id}`,
      sha256: "not_configured",
      status: "active" as const,
    }]));
  }

  async findByPublicId(publicId: string): Promise<DownloadTemplate | null> {
    return structuredClone(this.templates.get(publicId) ?? null);
  }
}

class InMemoryDownloadEventRepository implements DownloadEventRepository {
  private readonly events = new Map<string, DownloadEvent>();

  async findByDeviceAndKey(deviceId: string, idempotencyKey: string): Promise<DownloadEvent | null> {
    return structuredClone(this.events.get(`${deviceId}:${idempotencyKey}`) ?? null);
  }

  async create(event: DownloadEvent): Promise<void> {
    this.events.set(`${event.deviceId}:${event.idempotencyKey}`, structuredClone(event));
  }

  async save(event: DownloadEvent): Promise<void> {
    this.events.set(`${event.deviceId}:${event.idempotencyKey}`, structuredClone(event));
  }
}

class NotConfiguredObjectSigner implements ObjectSigner {
  async sign(): Promise<{ url: string; expiresAt: Date }> {
    throw new Error("object storage not configured");
  }
}

class InMemoryCodeRepository implements CodeRepository {
  private readonly records = new Map<string, CodeRecord>();

  async findByDigest(codeDigest: string): Promise<CodeRecord | null> {
    return structuredClone(this.records.get(codeDigest) ?? null);
  }

  async markRedeemed(codeDigest: string, deviceId: string, redeemedAt: Date): Promise<boolean> {
    const current = this.records.get(codeDigest);
    if (!current || current.redeemedAt) return false;
    this.records.set(codeDigest, { ...current, redeemedByDeviceId: deviceId, redeemedAt });
    return true;
  }
}

class InMemoryRecoveryCodeRepository implements RecoveryCodeRepository {
  private readonly records = new Map<string, RecoveryCodeRecord>();

  async findByDigest(recoveryDigest: string): Promise<RecoveryCodeRecord | null> {
    return structuredClone(this.records.get(recoveryDigest) ?? null);
  }

  async markUsed(recoveryDigest: string, usedAt: Date): Promise<boolean> {
    const current = this.records.get(recoveryDigest);
    if (!current || current.usedAt) return false;
    this.records.set(recoveryDigest, { ...current, usedAt });
    return true;
  }

  async create(record: RecoveryCodeRecord): Promise<void> {
    this.records.set(record.recoveryDigest, structuredClone(record));
  }
}
