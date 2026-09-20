import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { AssetStandardEngine, type StandardSnapshot } from "../src/domain/asset-standard-engine.js";
import { StandardEvolutionService } from "../src/domain/standard-evolution-service.js";
import { FileStandardReleaseStore } from "../src/infrastructure/standard-release-store.js";

const BASE_ASSET = {
  public_id: "tpl_risk_standard",
  display_name: "项目风险登记表（标准版）",
  canonical_title: "项目风险登记表",
  intent: "risk_register",
  intent_name: "风险登记",
  industry: "通用项目管理",
  project_phase: "执行",
  roles: ["项目经理", "风险责任人"],
  purpose: "识别并跟踪项目风险",
  output: "风险台账",
  field_names: ["风险事项", "概率", "影响", "责任人"],
  variant: "standard",
  variant_label: "标准版",
  regulated: false,
  compliance_review: "启用前确认",
  object_tags: ["风险"],
} as const;

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function setup() {
  const directory = await mkdtemp(join(tmpdir(), "office-standard-release-"));
  temporaryDirectories.push(directory);
  const activePath = join(directory, "standards.public.json");
  const historyDirectory = join(directory, "history");
  const snapshot = AssetStandardEngine.fromAssets([BASE_ASSET], "1.0.0").snapshot();
  await writeFile(activePath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  const report = new StandardEvolutionService().scan(snapshot, [{
    ...BASE_ASSET,
    public_id: "tpl_risk_review",
    field_names: [...BASE_ASSET.field_names, "根因分析"],
  }]);
  const store = new FileStandardReleaseStore({
    activePath,
    historyDirectory,
    now: () => new Date("2026-09-20T08:00:00.000Z"),
    idFactory: () => "test-record",
  });
  return { activePath, historyDirectory, snapshot, report, store };
}

describe("FileStandardReleaseStore", () => {
  test("persists immutable versions and a change record before activating a promotion", async () => {
    const { activePath, historyDirectory, report, store } = await setup();

    const result = await store.promote(report, {
      approvedBy: "reviewer",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    });

    const active = JSON.parse(await readFile(activePath, "utf8")) as StandardSnapshot;
    expect(active.version).toBe("1.0.1");
    expect(active.standards[0]?.recommended_fields).toContain("根因分析");
    expect(result.snapshot).toEqual(active);
    await expect(readFile(join(historyDirectory, "versions", "1.0.0.json"), "utf8")).resolves.toContain('"version": "1.0.0"');
    await expect(readFile(join(historyDirectory, "versions", "1.0.1.json"), "utf8")).resolves.toContain('"version": "1.0.1"');
    await expect(readFile(join(historyDirectory, "changes", "1.0.0-to-1.0.1.json"), "utf8")).resolves.toContain(
      '"approved_by": "reviewer"',
    );
  });

  test("keeps the active snapshot unchanged when promotion controls fail", async () => {
    const { activePath, report, snapshot, store } = await setup();

    await expect(store.promote(report, {
      approvedBy: "",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    })).rejects.toThrow("review approval required");

    expect(JSON.parse(await readFile(activePath, "utf8"))).toEqual(snapshot);
  });

  test("rolls back atomically to an immutable version and writes an audit record", async () => {
    const { activePath, historyDirectory, report, store } = await setup();
    await store.promote(report, {
      approvedBy: "reviewer",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    });

    const rollback = await store.rollback("1.0.0", {
      approvedBy: "reviewer",
      reason: "C01-A reversible release drill",
    });

    const active = JSON.parse(await readFile(activePath, "utf8")) as StandardSnapshot;
    expect(active.version).toBe("1.0.0");
    expect(rollback).toMatchObject({
      schema_version: "office-standard-rollback/v1",
      from_version: "1.0.1",
      to_version: "1.0.0",
      approved_by: "reviewer",
      reason: "C01-A reversible release drill",
      recorded_at: "2026-09-20T08:00:00.000Z",
    });
    const changes = await readdir(join(historyDirectory, "changes"));
    expect(changes).toContain("rollback-1.0.1-to-1.0.0-test-record.json");
  });
});
