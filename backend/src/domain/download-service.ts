export type DownloadState = "received" | "authenticated" | "reserved" | "signed" | "delivered" | "released";

export interface DownloadTemplate {
  publicId: string;
  accessTier: "free" | "paid";
  objectKey: string;
  sha256: string;
  status: "active" | "disabled";
}

export interface DownloadEvent {
  deviceId: string;
  idempotencyKey: string;
  publicId: string;
  state: DownloadState;
  createdAt: Date;
  updatedAt: Date;
  reservationId?: string;
  result?: DownloadResult;
}

export interface DownloadResult {
  public_id: string;
  download_url: string;
  expires_at: string;
  sha256: string;
  quota_remaining: number;
}

export interface DownloadRequest {
  deviceId: string;
  deviceSecret: string;
  idempotencyKey: string;
  publicId: string;
}

export interface DeviceAuthenticator {
  authenticate(deviceId: string, deviceSecret: string): Promise<void>;
}

export interface DownloadTemplateRepository {
  findByPublicId(publicId: string): Promise<DownloadTemplate | null>;
}

export interface DownloadEntitlementRepository {
  hasPaidAccess(deviceId: string, at: Date): Promise<boolean>;
}

export interface DownloadQuotaReservation {
  reservationId: string;
  remainingAfterDelivery: number;
}

export interface DownloadQuotaService {
  reserve(deviceId: string, at: Date): Promise<DownloadQuotaReservation>;
  commit(reservationId: string): Promise<void>;
  release(reservationId: string): Promise<void>;
}

export interface DownloadEventRepository {
  findByDeviceAndKey(deviceId: string, idempotencyKey: string): Promise<DownloadEvent | null>;
  create(event: DownloadEvent): Promise<void>;
  save(event: DownloadEvent): Promise<void>;
}

export interface ObjectSigner {
  sign(objectKey: string): Promise<{ url: string; expiresAt: Date }>;
}

export interface DownloadServiceDependencies {
  authenticator: DeviceAuthenticator;
  templateRepository: DownloadTemplateRepository;
  entitlements: DownloadEntitlementRepository;
  quota: DownloadQuotaService;
  events: DownloadEventRepository;
  signer: ObjectSigner;
  clock?: () => Date;
}

export class DownloadConflictError extends Error {
  readonly code = "IDEMPOTENCY_CONFLICT";

  constructor() {
    super("同一幂等键的请求参数不一致");
  }
}

export class DownloadAccessError extends Error {
  readonly code = "FORBIDDEN_ASSET";

  constructor() {
    super("当前设备无权下载该资产");
  }
}

export class DownloadSignError extends Error {
  readonly code = "DEPENDENCY_UNAVAILABLE";

  constructor() {
    super("下载凭证签发失败");
  }
}

export class TemplateNotFoundError extends Error {
  readonly code = "TEMPLATE_NOT_FOUND";

  constructor() {
    super("模板不存在或不可用");
  }
}

export class DownloadService {
  private readonly clock: () => Date;

  constructor(private readonly dependencies: DownloadServiceDependencies) {
    this.clock = dependencies.clock ?? (() => new Date());
  }

  async download(request: DownloadRequest): Promise<DownloadResult> {
    const existing = await this.dependencies.events.findByDeviceAndKey(request.deviceId, request.idempotencyKey);
    if (existing) {
      if (existing.publicId !== request.publicId) {
        throw new DownloadConflictError();
      }
      if (existing.state === "delivered" && existing.result) {
        return existing.result;
      }
    }

    const now = this.clock();
    const event: DownloadEvent = existing ?? {
      deviceId: request.deviceId,
      idempotencyKey: request.idempotencyKey,
      publicId: request.publicId,
      state: "received",
      createdAt: now,
      updatedAt: now,
    };
    if (!existing) {
      await this.dependencies.events.create(event);
    }

    await this.dependencies.authenticator.authenticate(request.deviceId, request.deviceSecret);
    await this.saveState(event, "authenticated");

    const template = await this.dependencies.templateRepository.findByPublicId(request.publicId);
    if (!template || template.status !== "active") {
      throw new TemplateNotFoundError();
    }
    if (template.accessTier === "paid" && !(await this.dependencies.entitlements.hasPaidAccess(request.deviceId, now))) {
      throw new DownloadAccessError();
    }

    const reservation = await this.dependencies.quota.reserve(request.deviceId, now);
    event.reservationId = reservation.reservationId;
    await this.saveState(event, "reserved");

    let signed: { url: string; expiresAt: Date };
    try {
      signed = await this.dependencies.signer.sign(template.objectKey);
    } catch {
      await this.dependencies.quota.release(reservation.reservationId);
      await this.saveState(event, "released");
      throw new DownloadSignError();
    }

    await this.saveState(event, "signed");
    await this.dependencies.quota.commit(reservation.reservationId);

    const result: DownloadResult = {
      public_id: template.publicId,
      download_url: signed.url,
      expires_at: signed.expiresAt.toISOString(),
      sha256: template.sha256,
      quota_remaining: reservation.remainingAfterDelivery,
    };
    event.result = result;
    await this.saveState(event, "delivered");
    return result;
  }

  private async saveState(event: DownloadEvent, state: DownloadState): Promise<void> {
    event.state = state;
    event.updatedAt = this.clock();
    await this.dependencies.events.save(event);
  }
}
