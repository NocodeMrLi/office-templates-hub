import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { Pool, PoolConfig } from "pg";

import { buildApp, type RegistrationResultStore } from "./app.js";
import { CatalogService, type PublicTemplate } from "./domain/catalog-service.js";
import { DeviceService, type DeviceRecord, type DeviceRepository } from "./domain/device-service.js";
import { CosObjectSigner, type CosGetObjectUrlClient } from "./infrastructure/cos-object-signer.js";
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
import { DocumentStoreCodeRepository } from "./infrastructure/document-store-code-repository.js";
import { DocumentStoreDeviceRepository } from "./infrastructure/document-store-device-repository.js";
import { DocumentStoreDownloadEventRepository } from "./infrastructure/document-store-download-event-repository.js";
import { DocumentStoreRecoveryCodeRepository } from "./infrastructure/document-store-recovery-code-repository.js";
import { DocumentStoreRegistrationResultStore } from "./infrastructure/document-store-registration-result-store.js";
import { DocumentStoreDownloadTemplateRepository } from "./infrastructure/document-store-template-repository.js";
import { DocumentStoreUsageQuotaRepository } from "./infrastructure/document-store-usage-quota-repository.js";
import { adaptCloudBaseCollection, type CloudBaseCommand } from "./infrastructure/document-store-cloudbase-adapter.js";
import {
  DocumentStorePostgresCollection,
  type PostgresQueryClient,
} from "./infrastructure/document-store-postgres-adapter.js";

export interface CloudBaseClient {
  database(): CloudBaseDatabase;
}

export interface CloudBaseDatabase {
  collection(name: string): unknown;
  command: CloudBaseCommand;
}

import { UsageQuotaService, type EntitlementRecord, type UsageQuotaRepository } from "./domain/usage-quota-service.js";
import type { DocumentStoreTemplateCollection } from "./infrastructure/document-store-template-repository.js";
import type { DocumentStoreDeviceCollection } from "./infrastructure/document-store-device-repository.js";
import type { DocumentStoreEntitlementCollection, DocumentStoreUsageDailyCollection } from "./infrastructure/document-store-usage-quota-repository.js";
import type { DocumentStoreRecoveryCodeCollection } from "./infrastructure/document-store-recovery-code-repository.js";
import type { DocumentStoreCodeCollection } from "./infrastructure/document-store-code-repository.js";
import type { DocumentStoreDownloadEventCollection } from "./infrastructure/document-store-download-event-repository.js";
import type { DocumentStoreRegistrationResultCollection } from "./infrastructure/document-store-registration-result-store.js";

export interface RuntimeAppOptions {
  catalogPath?: string;
  devicePepper: string;
  codePepper: string;
  recoveryPepper: string;
  cloudbase?: RuntimeCloudBaseOptions;
  postgres?: RuntimePostgresOptions;
  cos?: RuntimeCosOptions;
  repositories?: RuntimeRepositories;
}

export interface RuntimeCloudBaseOptions {
  envId: string;
  client?: CloudBaseClient;
}

export interface RuntimePostgresOptions {
  connectionString: string;
  ssl?: boolean;
  client?: PostgresQueryClient;
}

export interface RuntimeEntitlementRepository extends DownloadEntitlementRepository {
  findActiveEntitlement(deviceId: string, at: Date): Promise<EntitlementRecord | null>;
}

interface WritableRuntimeEntitlementRepository extends RuntimeEntitlementRepository {
  create(record: EntitlementRecord): Promise<void>;
}

export interface RuntimeRepositories {
  devices: DeviceRepository;
  entitlements: RuntimeEntitlementRepository;
  usage: UsageQuotaRepository;
  recoveryCodes: RecoveryCodeRepository;
  codes: CodeRepository;
  downloadEvents: DownloadEventRepository;
  registrationResults: RegistrationResultStore;
  templates?: DownloadTemplateRepository;
  downloadQuota?: DownloadQuotaService;
  health(): Promise<"ok" | "unavailable">;
}

export interface RuntimeCosOptions {
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  expiresSeconds?: number;
  objectPrefix?: string;
  client?: CosGetObjectUrlClient;
}

interface CatalogSource {
  count: number;
  items: PublicTemplate[];
}

export async function createRuntimeApp(options: RuntimeAppOptions) {
  const catalogSource = readCatalog(options.catalogPath);
  const repositories = options.repositories ?? (options.postgres
    ? createRuntimeRepositoriesForPostgres(options.postgres.client ?? createPostgresClient(options.postgres))
    : options.cloudbase
    ? createRuntimeRepositoriesForCloudBase(
        options.cloudbase.client?.database() ?? createCloudBaseClient(options.cloudbase.envId).database(),
      )
    : createInMemoryRuntimeRepositories());
  const devices = repositories.devices;
  const entitlements = repositories.entitlements;
  const usage = repositories.usage;
  const recoveryCodes = repositories.recoveryCodes;
  const codeRepository = repositories.codes;
  const downloadEvents = repositories.downloadEvents;
  const catalogService = CatalogService.fromUnknown(catalogSource);
  const deviceService = new DeviceService(devices, options.devicePepper);
  const usageQuotaService = new UsageQuotaService(usage);
  const templateRepository = repositories.templates ?? new CatalogBackedDownloadTemplateRepository(
    catalogSource.items,
    options.cos?.objectPrefix ?? "templates/",
  );
  const objectStorage = createObjectStorage(options.cos);

  return buildApp({
    deviceService,
    registrationResults: repositories.registrationResults,
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
      quota: repositories.downloadQuota ?? new InMemoryDownloadQuotaService(entitlements),
      events: downloadEvents,
      signer: objectStorage.signer,
    }),
    redeemService: new RedeemService(codeRepository, usageQuotaService, options.codePepper),
    recoveryService: new RecoveryService({
      devices,
      recoveryCodes,
      devicePepper: options.devicePepper,
      recoveryPepper: options.recoveryPepper,
    }),
    health: async () => ({ database: await repositories.health(), objectStorage: objectStorage.status }),
  });
}

export function createRuntimeRepositoriesForPostgres(client: PostgresQueryClient): RuntimeRepositories {
  const templatesCollection = postgresCollection(client, "templates");
  const devicesCollection = postgresCollection(client, "devices");
  const entitlementsCollection = postgresCollection(client, "entitlements");
  const usageDailyCollection = postgresCollection(client, "usage_daily");
  const recoveryCodesCollection = postgresCollection(client, "recovery_codes");
  const codesCollection = postgresCollection(client, "codes");
  const downloadEventsCollection = postgresCollection(client, "download_events");
  const registrationResultsCollection = postgresCollection(client, "registration_results");

  const templates = new DocumentStoreDownloadTemplateRepository(
    templatesCollection as DocumentStoreTemplateCollection,
  );
  const devices = new DocumentStoreDeviceRepository(
    devicesCollection as DocumentStoreDeviceCollection,
  );
  const entitlementsAndUsage = new DocumentStoreUsageQuotaRepository(
    entitlementsCollection as DocumentStoreEntitlementCollection,
    usageDailyCollection as DocumentStoreUsageDailyCollection,
  );
  const recoveryCodes = new DocumentStoreRecoveryCodeRepository(
    recoveryCodesCollection as DocumentStoreRecoveryCodeCollection,
  );
  const codes = new DocumentStoreCodeRepository(codesCollection as DocumentStoreCodeCollection);
  const downloadEvents = new DocumentStoreDownloadEventRepository(
    downloadEventsCollection as DocumentStoreDownloadEventCollection,
  );
  const registrationResults = new DocumentStoreRegistrationResultStore(
    registrationResultsCollection as DocumentStoreRegistrationResultCollection,
  );

  return {
    devices,
    entitlements: entitlementsAndUsage,
    usage: entitlementsAndUsage,
    recoveryCodes,
    codes,
    downloadEvents,
    registrationResults,
    templates,
    health: async () => probePostgresHealth(client),
  };
}

function postgresCollection(client: PostgresQueryClient, table: string): DocumentStorePostgresCollection {
  return new DocumentStorePostgresCollection({ table, client });
}

async function probePostgresHealth(client: PostgresQueryClient): Promise<"ok" | "unavailable"> {
  try {
    await client.query("SELECT 1");
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function createRuntimeRepositoriesForCloudBase(database: CloudBaseDatabase): RuntimeRepositories {
  const templatesCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "templates"));
  const devicesCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "devices"));
  const entitlementsCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "entitlements"), {
    command: database.command,
  });
  const usageDailyCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "usage_daily"), {
    command: database.command,
  });
  const recoveryCodesCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "recovery_codes"));
  const codesCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "codes"));
  const downloadEventsCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "download_events"));
  const registrationResultsCollection = adaptCloudBaseCollection(cloudBaseCollection(database, "registration_results"));

  const templates = new DocumentStoreDownloadTemplateRepository(
    templatesCollection as DocumentStoreTemplateCollection,
  );
  const devices = new DocumentStoreDeviceRepository(
    devicesCollection as DocumentStoreDeviceCollection,
  );
  const entitlementsAndUsage = new DocumentStoreUsageQuotaRepository(
    entitlementsCollection as DocumentStoreEntitlementCollection,
    usageDailyCollection as DocumentStoreUsageDailyCollection,
  );
  const recoveryCodes = new DocumentStoreRecoveryCodeRepository(
    recoveryCodesCollection as DocumentStoreRecoveryCodeCollection,
  );
  const codes = new DocumentStoreCodeRepository(codesCollection as DocumentStoreCodeCollection);
  const downloadEvents = new DocumentStoreDownloadEventRepository(
    downloadEventsCollection as DocumentStoreDownloadEventCollection,
  );
  const registrationResults = new DocumentStoreRegistrationResultStore(
    registrationResultsCollection as DocumentStoreRegistrationResultCollection,
  );

  return {
    devices,
    entitlements: entitlementsAndUsage,
    usage: entitlementsAndUsage,
    recoveryCodes,
    codes,
    downloadEvents,
    registrationResults,
    templates,
    health: async () => probeCloudBaseHealth(templatesCollection),
  };
}

function cloudBaseCollection(database: CloudBaseDatabase, name: string) {
  return database.collection(name) as Parameters<typeof adaptCloudBaseCollection>[0];
}

async function probeCloudBaseHealth(
  templates: ReturnType<typeof adaptCloudBaseCollection>,
): Promise<"ok" | "unavailable"> {
  try {
    await templates.findOne({ status: "active" });
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function createInMemoryRuntimeRepositories(): RuntimeRepositories {
  const entitlements = new InMemoryEntitlementRepository();
  return {
    devices: new InMemoryDeviceRepository(),
    entitlements,
    usage: new InMemoryUsageQuotaRepository(entitlements),
    recoveryCodes: new InMemoryRecoveryCodeRepository(),
    codes: new InMemoryCodeRepository(),
    downloadEvents: new InMemoryDownloadEventRepository(),
    registrationResults: new InMemoryRegistrationResultStore(),
    health: async () => "ok",
  };
}

function createCloudBaseClient(envId: string): CloudBaseClient {
  const require = createRequire(import.meta.url);
  const cloudbase = require("@cloudbase/node-sdk") as {
    init(options: { env: string }): CloudBaseClient;
  };
  return cloudbase.init({ env: envId });
}

function createPostgresClient(options: RuntimePostgresOptions): PostgresQueryClient {
  const require = createRequire(import.meta.url);
  const pg = require("pg") as { Pool: new (config: PoolConfig) => Pool };
  const config = options.ssl
    ? { connectionString: options.connectionString, ssl: { rejectUnauthorized: false } }
    : { connectionString: options.connectionString };
  return new pg.Pool(config) as Pool;
}

function createObjectStorage(cos: RuntimeCosOptions | undefined): {
  status: "ok" | "not_configured";
  signer: CosObjectSigner | NotConfiguredObjectSigner;
} {
  if (!cos) {
    return { status: "not_configured", signer: new NotConfiguredObjectSigner() };
  }
  const client = cos.client ?? createCosClient(cos.secretId, cos.secretKey);
  return {
    status: "ok",
    signer: new CosObjectSigner(client, {
      bucket: cos.bucket,
      region: cos.region,
      expiresSeconds: cos.expiresSeconds ?? 300,
    }),
  };
}

function createCosClient(secretId: string, secretKey: string): CosGetObjectUrlClient {
  const require = createRequire(import.meta.url);
  const COS = require("cos-nodejs-sdk-v5") as new (options: {
    SecretId: string;
    SecretKey: string;
  }) => CosGetObjectUrlClient;
  return new COS({
    SecretId: secretId,
    SecretKey: secretKey,
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

class InMemoryEntitlementRepository implements WritableRuntimeEntitlementRepository {
  readonly entitlements: EntitlementRecord[] = [];

  async create(record: EntitlementRecord): Promise<void> {
    this.entitlements.push(structuredClone(record));
  }

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

  constructor(private readonly entitlementRepository: WritableRuntimeEntitlementRepository) {}

  async createEntitlement(record: EntitlementRecord): Promise<void> {
    await this.entitlementRepository.create(record);
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

  constructor(private readonly entitlements: RuntimeEntitlementRepository) {}

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

  constructor(items: readonly PublicTemplate[], objectPrefix: string) {
    const normalizedObjectPrefix = normalizeObjectPrefix(objectPrefix);
    this.templates = new Map(items.map((item) => [item.public_id, {
      publicId: item.public_id,
      accessTier: item.access_tier,
      objectKey: `${normalizedObjectPrefix}${item.public_id}.xlsx`,
      sha256: "not_configured",
      status: "active" as const,
    }]));
  }

  async findByPublicId(publicId: string): Promise<DownloadTemplate | null> {
    return structuredClone(this.templates.get(publicId) ?? null);
  }
}

function normalizeObjectPrefix(prefix: string): string {
  const withoutLeadingSlash = prefix.replace(/^\/+/, "");
  if (withoutLeadingSlash === "") return "";
  return withoutLeadingSlash.endsWith("/") ? withoutLeadingSlash : `${withoutLeadingSlash}/`;
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
