import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import { parseStandardSnapshot, type StandardSnapshot } from "../domain/asset-standard-engine.js";
import {
  StandardEvolutionService,
  type PromotionControls,
  type StandardEvolutionReport,
  type StandardPromotionResult,
} from "../domain/standard-evolution-service.js";

export interface StandardRollbackControls {
  approvedBy: string;
  reason: string;
}

export interface StandardRollbackRecord {
  schema_version: "office-standard-rollback/v1";
  from_version: string;
  to_version: string;
  approved_by: string;
  reason: string;
  recorded_at: string;
}

export interface FileStandardReleaseStoreOptions {
  activePath: string;
  historyDirectory: string;
  now?: () => Date;
  idFactory?: () => string;
}

export class FileStandardReleaseStore {
  private readonly activePath: string;
  private readonly historyDirectory: string;
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly evolution = new StandardEvolutionService();

  constructor(options: FileStandardReleaseStoreOptions) {
    this.activePath = resolve(options.activePath);
    this.historyDirectory = resolve(options.historyDirectory);
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? randomUUID;
  }

  async readActive(): Promise<StandardSnapshot> {
    return readSnapshot(this.activePath);
  }

  async promote(
    report: StandardEvolutionReport,
    controls: PromotionControls,
  ): Promise<StandardPromotionResult> {
    const active = await this.readActive();
    const result = this.evolution.promote(active, report, controls);
    parseStandardSnapshot(result.snapshot);

    await this.persistVersion(active);
    await this.persistVersion(result.snapshot);
    await writeImmutableJson(
      join(this.historyDirectory, "changes", `${active.version}-to-${result.snapshot.version}.json`),
      result.change_record,
    );
    await writeJsonAtomically(this.activePath, result.snapshot);
    return result;
  }

  async rollback(targetVersion: string, controls: StandardRollbackControls): Promise<StandardRollbackRecord> {
    validateSemanticVersion(targetVersion);
    const approvedBy = controls.approvedBy.trim();
    const reason = controls.reason.trim();
    if (!approvedBy) throw new Error("rollback approval required");
    if (!reason) throw new Error("rollback reason required");

    const active = await this.readActive();
    if (active.version === targetVersion) {
      throw new Error("rollback target is already active");
    }
    const target = await readSnapshot(this.versionPath(targetVersion));
    if (target.version !== targetVersion) {
      throw new Error("rollback target version does not match stored snapshot");
    }

    const record: StandardRollbackRecord = {
      schema_version: "office-standard-rollback/v1",
      from_version: active.version,
      to_version: target.version,
      approved_by: approvedBy,
      reason,
      recorded_at: this.now().toISOString(),
    };
    await this.persistVersion(active);
    await writeImmutableJson(
      join(
        this.historyDirectory,
        "changes",
        `rollback-${active.version}-to-${target.version}-${safeRecordId(this.idFactory())}.json`,
      ),
      record,
    );
    await writeJsonAtomically(this.activePath, target);
    return record;
  }

  private versionPath(version: string): string {
    validateSemanticVersion(version);
    return join(this.historyDirectory, "versions", `${version}.json`);
  }

  private async persistVersion(snapshot: StandardSnapshot): Promise<void> {
    await writeImmutableJson(this.versionPath(snapshot.version), parseStandardSnapshot(snapshot));
  }
}

async function readSnapshot(path: string): Promise<StandardSnapshot> {
  return parseStandardSnapshot(JSON.parse(await readFile(path, "utf8")) as unknown);
}

async function writeImmutableJson(path: string, value: unknown): Promise<void> {
  const serialized = serialize(value);
  await mkdir(dirname(path), { recursive: true });
  try {
    await writeFile(path, serialized, { encoding: "utf8", flag: "wx" });
  } catch (error) {
    if (!isAlreadyExists(error)) throw error;
    const existing = await readFile(path, "utf8");
    if (existing !== serialized) {
      throw new Error(`immutable standard history conflict: ${path}`, { cause: error });
    }
  }
}

async function writeJsonAtomically(path: string, value: unknown): Promise<void> {
  const destination = resolve(path);
  const temporary = `${destination}.${process.pid}.${randomUUID()}.tmp`;
  await mkdir(dirname(destination), { recursive: true });
  try {
    await writeFile(temporary, serialize(value), { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
  } finally {
    await rm(temporary, { force: true });
  }
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function validateSemanticVersion(version: string): void {
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error("standard version must be semantic");
  }
}

function safeRecordId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/gu, "-");
  if (!normalized) throw new Error("rollback record id is invalid");
  return normalized;
}

function isAlreadyExists(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "EEXIST";
}
