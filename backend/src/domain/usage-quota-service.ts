export type UsageTier = "free" | "paid";

export interface EntitlementRecord {
  deviceId: string;
  source: "afdian";
  sourceOrderId: string;
  startsAt: Date;
  expiresAt: Date;
  createdAt: Date;
}

export interface UsageQuotaRepository {
  createEntitlement(record: EntitlementRecord): Promise<void>;
  findActiveEntitlement(deviceId: string, at: Date): Promise<EntitlementRecord | null>;
  consumeDaily(deviceId: string, date: string, limit: number): Promise<{ allowed: boolean; used: number }>;
}

export interface UsageAuthorization {
  allowed: boolean;
  tier: UsageTier;
  limit: number;
  used: number;
  day: string;
}

const CHINA_OFFSET_MS = 8 * 60 * 60 * 1000;
const FREE_DAILY_LIMIT = 5;
const PAID_DAILY_LIMIT = 30;

export class UsageQuotaService {
  constructor(
    private readonly repository: UsageQuotaRepository,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async authorizeCall(deviceId: string): Promise<UsageAuthorization> {
    const now = this.clock();
    const activeEntitlement = await this.repository.findActiveEntitlement(deviceId, now);
    const tier: UsageTier = activeEntitlement ? "paid" : "free";
    const limit = tier === "paid" ? PAID_DAILY_LIMIT : FREE_DAILY_LIMIT;
    const day = chinaDayKey(now);
    const consumption = await this.repository.consumeDaily(deviceId, day, limit);

    return {
      allowed: consumption.allowed,
      tier,
      limit,
      used: consumption.used,
      day,
    };
  }

  async grantSubscriptionMonth(deviceId: string, sourceOrderId: string): Promise<EntitlementRecord> {
    const now = this.clock();
    const record: EntitlementRecord = {
      deviceId,
      source: "afdian",
      sourceOrderId,
      startsAt: now,
      expiresAt: addOneChinaCalendarMonth(now),
      createdAt: now,
    };
    await this.repository.createEntitlement(record);
    return record;
  }
}

function chinaDayKey(date: Date): string {
  const local = new Date(date.getTime() + CHINA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = String(local.getUTCMonth() + 1).padStart(2, "0");
  const day = String(local.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addOneChinaCalendarMonth(date: Date): Date {
  const local = new Date(date.getTime() + CHINA_OFFSET_MS);
  const year = local.getUTCFullYear();
  const month = local.getUTCMonth();
  const targetMonth = month + 1;
  const targetYear = year + Math.floor(targetMonth / 12);
  const normalizedTargetMonth = targetMonth % 12;
  const day = Math.min(local.getUTCDate(), daysInMonth(targetYear, normalizedTargetMonth));

  return new Date(Date.UTC(
    targetYear,
    normalizedTargetMonth,
    day,
    local.getUTCHours(),
    local.getUTCMinutes(),
    local.getUTCSeconds(),
    local.getUTCMilliseconds(),
  ) - CHINA_OFFSET_MS);
}

function daysInMonth(year: number, zeroBasedMonth: number): number {
  return new Date(Date.UTC(year, zeroBasedMonth + 1, 0)).getUTCDate();
}
