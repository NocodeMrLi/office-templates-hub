import { createHmac } from "node:crypto";

import type { EntitlementRecord } from "./usage-quota-service.js";

export type CodeType = "afdian_month";
export type CodeStatus = "active" | "disabled";

export interface CodeRecord {
  codeDigest: string;
  type: CodeType;
  status: CodeStatus;
  sourceOrderId: string;
  createdAt: Date;
  expiresAt?: Date;
  redeemedByDeviceId?: string;
  redeemedAt?: Date;
}

export interface CodeRepository {
  findByDigest(codeDigest: string): Promise<CodeRecord | null>;
  markRedeemed(codeDigest: string, deviceId: string, redeemedAt: Date): Promise<boolean>;
}

export interface SubscriptionGrantService {
  grantSubscriptionMonth(deviceId: string, sourceOrderId: string): Promise<EntitlementRecord>;
}

export interface RedeemRequest {
  deviceId: string;
  code: string;
}

export interface RedeemResult {
  entitlement: CodeType;
  daily_limit: number;
  expires_at: string;
}

export class RedeemCodeError extends Error {
  readonly code = "INVALID_REDEEM_CODE";

  constructor() {
    super("兑换码无效或已失效");
  }
}

export class RedeemService {
  constructor(
    private readonly repository: CodeRepository,
    private readonly grants: SubscriptionGrantService,
    private readonly pepper: string,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  digestCodeForImport(code: string): string {
    return this.digest(code);
  }

  async redeem(request: RedeemRequest): Promise<RedeemResult> {
    const now = this.clock();
    const codeDigest = this.digest(request.code);
    const record = await this.repository.findByDigest(codeDigest);
    if (!record || !this.canRedeem(record, now)) {
      throw new RedeemCodeError();
    }

    const marked = await this.repository.markRedeemed(codeDigest, request.deviceId, now);
    if (!marked) {
      throw new RedeemCodeError();
    }

    const entitlement = await this.grants.grantSubscriptionMonth(request.deviceId, record.sourceOrderId);
    return {
      entitlement: record.type,
      daily_limit: 30,
      expires_at: entitlement.expiresAt.toISOString(),
    };
  }

  private canRedeem(record: CodeRecord, now: Date): boolean {
    return record.type === "afdian_month"
      && record.status === "active"
      && !record.redeemedAt
      && (record.expiresAt === undefined || record.expiresAt.getTime() > now.getTime());
  }

  private digest(code: string): string {
    return createHmac("sha256", this.pepper).update(code, "utf8").digest("hex");
  }
}
