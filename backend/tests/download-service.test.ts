import { describe, expect, test } from "vitest";

import {
  DownloadAccessError,
  DownloadConflictError,
  DownloadService,
  DownloadSignError,
  type DeviceAuthenticator,
  type DownloadEntitlementRepository,
  type DownloadEvent,
  type DownloadEventRepository,
  type DownloadQuotaService,
  type DownloadTemplate,
  type DownloadTemplateRepository,
  type ObjectSigner,
} from "../src/domain/download-service.js";

class TestDownloadEventRepository implements DownloadEventRepository {
  readonly events = new Map<string, DownloadEvent>();
  readonly states: string[] = [];

  async findByDeviceAndKey(deviceId: string, idempotencyKey: string): Promise<DownloadEvent | null> {
    return structuredClone(this.events.get(`${deviceId}:${idempotencyKey}`) ?? null);
  }

  async create(event: DownloadEvent): Promise<void> {
    this.events.set(`${event.deviceId}:${event.idempotencyKey}`, structuredClone(event));
    this.states.push(event.state);
  }

  async save(event: DownloadEvent): Promise<void> {
    this.events.set(`${event.deviceId}:${event.idempotencyKey}`, structuredClone(event));
    this.states.push(event.state);
  }
}

class TestQuotaService implements DownloadQuotaService {
  commits = 0;
  releases = 0;
  reserves = 0;

  async reserve(): Promise<{ reservationId: string; remainingAfterDelivery: number }> {
    this.reserves += 1;
    return { reservationId: `reservation-${this.reserves}`, remainingAfterDelivery: 4 };
  }

  async commit(): Promise<void> {
    this.commits += 1;
  }

  async release(): Promise<void> {
    this.releases += 1;
  }
}

function createService(options?: {
  signer?: ObjectSigner;
  entitlements?: DownloadEntitlementRepository;
  templates?: DownloadTemplate[];
}) {
  const events = new TestDownloadEventRepository();
  const quota = new TestQuotaService();
  const authenticator: DeviceAuthenticator = {
    authenticate: async (deviceId, secret) => {
      if (deviceId !== "device-1" || secret !== "secret-1") {
        throw new Error("unauthorized");
      }
    },
  };
  const templates = new Map((options?.templates ?? [{
    publicId: "tpl_free",
    accessTier: "free",
    objectKey: "private/templates/tpl_free.xlsx",
    sha256: "sha-free",
    status: "active",
  }]).map((template) => [template.publicId, template]));
  const templateRepository: DownloadTemplateRepository = {
    findByPublicId: async (publicId) => structuredClone(templates.get(publicId) ?? null),
  };
  const entitlements: DownloadEntitlementRepository = options?.entitlements ?? {
    hasPaidAccess: async () => false,
  };
  const signer: ObjectSigner = options?.signer ?? {
    sign: async () => ({
      url: "https://signed.example/download",
      expiresAt: new Date("2026-09-12T10:05:00.000Z"),
    }),
  };

  return {
    service: new DownloadService({
      authenticator,
      templateRepository,
      entitlements,
      quota,
      events,
      signer,
      clock: () => new Date("2026-09-12T10:00:00.000Z"),
    }),
    events,
    quota,
  };
}

describe("DownloadService", () => {
  test("moves through the delivery states and commits quota only after a signed URL is delivered", async () => {
    const { service, events, quota } = createService();

    const result = await service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_free",
    });

    expect(result).toEqual({
      public_id: "tpl_free",
      download_url: "https://signed.example/download",
      expires_at: "2026-09-12T10:05:00.000Z",
      sha256: "sha-free",
      quota_remaining: 4,
    });
    expect(events.states).toEqual(["received", "authenticated", "reserved", "signed", "delivered"]);
    expect(quota.commits).toBe(1);
    expect(quota.releases).toBe(0);
  });

  test("releases reserved quota when signing fails", async () => {
    const { service, events, quota } = createService({
      signer: {
        sign: async () => {
          throw new Error("cos unavailable");
        },
      },
    });

    await expect(service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_free",
    })).rejects.toEqual(new DownloadSignError());

    expect(events.states).toEqual(["received", "authenticated", "reserved", "released"]);
    expect(quota.commits).toBe(0);
    expect(quota.releases).toBe(1);
  });

  test("replays the delivered result for the same idempotency key without signing or committing again", async () => {
    let signCalls = 0;
    const { service, quota } = createService({
      signer: {
        sign: async () => {
          signCalls += 1;
          return {
            url: `https://signed.example/download-${signCalls}`,
            expiresAt: new Date("2026-09-12T10:05:00.000Z"),
          };
        },
      },
    });

    const first = await service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_free",
    });
    const second = await service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_free",
    });

    expect(second).toEqual(first);
    expect(signCalls).toBe(1);
    expect(quota.commits).toBe(1);
  });

  test("rejects the same idempotency key when the request parameters change", async () => {
    const { service } = createService({
      templates: [
        { publicId: "tpl_free", accessTier: "free", objectKey: "private/templates/tpl_free.xlsx", sha256: "sha-free", status: "active" },
        { publicId: "tpl_other", accessTier: "free", objectKey: "private/templates/tpl_other.xlsx", sha256: "sha-other", status: "active" },
      ],
    });

    await service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_free",
    });

    await expect(service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_other",
    })).rejects.toEqual(new DownloadConflictError());
  });

  test("requires paid entitlement before signing a paid template", async () => {
    const { service, quota } = createService({
      templates: [{
        publicId: "tpl_paid",
        accessTier: "paid",
        objectKey: "private/templates/tpl_paid.xlsx",
        sha256: "sha-paid",
        status: "active",
      }],
    });

    await expect(service.download({
      deviceId: "device-1",
      deviceSecret: "secret-1",
      idempotencyKey: "download-1",
      publicId: "tpl_paid",
    })).rejects.toEqual(new DownloadAccessError());

    expect(quota.reserves).toBe(0);
  });
});
