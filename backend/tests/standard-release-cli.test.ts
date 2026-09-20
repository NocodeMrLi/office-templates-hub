import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, test } from "vitest";

import { AssetStandardEngine, type StandardSnapshot } from "../src/domain/asset-standard-engine.js";
import { StandardEvolutionService } from "../src/domain/standard-evolution-service.js";

const execFileAsync = promisify(execFile);
const temporaryDirectories: string[] = [];

const ASSET = {
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

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("standard release command line", () => {
  test("scans new assets through the package command separator", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-standard-scan-cli-"));
    temporaryDirectories.push(directory);
    const snapshotPath = join(directory, "active.json");
    const assetsPath = join(directory, "new-assets.json");
    const reportPath = join(directory, "report.json");
    await writeFile(
      snapshotPath,
      `${JSON.stringify(AssetStandardEngine.fromAssets([ASSET], "1.0.0").snapshot(), null, 2)}\n`,
      "utf8",
    );
    await writeFile(assetsPath, JSON.stringify([{
      ...ASSET,
      public_id: "tpl_risk_review",
      field_names: [...ASSET.field_names, "根因分析"],
    }]), "utf8");

    await execFileAsync("pnpm", ["standards:scan", "--", snapshotPath, assetsPath, reportPath], {
      cwd: process.cwd(),
    });

    const report = JSON.parse(await readFile(reportPath, "utf8")) as { candidates: unknown[] };
    expect(report.candidates).toHaveLength(1);
  });

  test("builds an explicitly versioned candidate without overwriting the active snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-standard-build-cli-"));
    temporaryDirectories.push(directory);
    const catalogPath = join(directory, "catalog.json");
    const activePath = join(directory, "active.json");
    const outputPath = join(directory, "candidate.json");
    const active = AssetStandardEngine.fromAssets([ASSET], "1.0.0").snapshot();
    await writeFile(catalogPath, JSON.stringify({ count: 1, items: [ASSET] }), "utf8");
    await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, "utf8");

    await execFileAsync("pnpm", [
      "exec", "tsx", "scripts/build-asset-standards.ts",
      "--catalog", catalogPath,
      "--version", "1.0.1",
      "--output", outputPath,
      "--active", activePath,
    ], { cwd: process.cwd() });

    const candidate = JSON.parse(await readFile(outputPath, "utf8")) as StandardSnapshot;
    expect(candidate.version).toBe("1.0.1");
    expect(JSON.parse(await readFile(activePath, "utf8"))).toEqual(active);
    await execFileAsync("pnpm", [
      "exec", "tsx", "scripts/check-active-standard.ts",
      "--catalog", catalogPath,
      "--snapshot", outputPath,
    ], { cwd: process.cwd() });
  });

  test("promotes and rolls back the active snapshot through explicit audited commands", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-standard-release-cli-"));
    temporaryDirectories.push(directory);
    const activePath = join(directory, "active.json");
    const historyDirectory = join(directory, "history");
    const reportPath = join(directory, "report.json");
    const active = AssetStandardEngine.fromAssets([ASSET], "1.0.0").snapshot();
    const report = new StandardEvolutionService().scan(active, [{
      ...ASSET,
      public_id: "tpl_risk_review",
      field_names: [...ASSET.field_names, "根因分析"],
    }]);
    await writeFile(activePath, `${JSON.stringify(active, null, 2)}\n`, "utf8");
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");

    await execFileAsync("pnpm", [
      "exec", "tsx", "scripts/promote-standard-snapshot.ts",
      "--active", activePath,
      "--history", historyDirectory,
      "--report", reportPath,
      "--approved-by", "reviewer",
      "--regression-passed", "true",
      "--rollback-version", "1.0.0",
    ], { cwd: process.cwd() });
    expect((JSON.parse(await readFile(activePath, "utf8")) as StandardSnapshot).version).toBe("1.0.1");

    await execFileAsync("pnpm", [
      "exec", "tsx", "scripts/rollback-standard-snapshot.ts",
      "--active", activePath,
      "--history", historyDirectory,
      "--target-version", "1.0.0",
      "--approved-by", "reviewer",
      "--reason", "C01-A reversible release drill",
    ], { cwd: process.cwd() });
    expect((JSON.parse(await readFile(activePath, "utf8")) as StandardSnapshot).version).toBe("1.0.0");
  });

  test("synchronizes and checks the human-readable standard document", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-standard-doc-cli-"));
    temporaryDirectories.push(directory);
    const snapshotPath = join(directory, "standards.json");
    const documentPath = join(directory, "standards.md");
    await writeFile(
      snapshotPath,
      `${JSON.stringify(AssetStandardEngine.fromAssets([ASSET], "1.0.0").snapshot(), null, 2)}\n`,
      "utf8",
    );
    await writeFile(documentPath, `# 标准
> 当前基线：旧
## 三、当前 0.0.1 标准基线
### 3.1 总体统计
旧
### 3.2 行业覆盖
旧
### 3.3 变体体系
旧
### 3.4 常见横向字段
人工规则
当前 9 项标准中有 9 项只有 1 份资产支持
## 十五、当前 9 项标准索引
<!-- CURRENT_STANDARD_INDEX:START version=0.0.1 source_assets=9 standards=9 -->
旧
<!-- CURRENT_STANDARD_INDEX:END -->
`, "utf8");

    await expect(execFileAsync("pnpm", [
      "exec", "tsx", "scripts/sync-standard-document.ts",
      "--snapshot", snapshotPath,
      "--document", documentPath,
      "--mode", "check",
    ], { cwd: process.cwd() })).rejects.toThrow();

    await execFileAsync("pnpm", [
      "exec", "tsx", "scripts/sync-standard-document.ts",
      "--snapshot", snapshotPath,
      "--document", documentPath,
      "--mode", "sync",
    ], { cwd: process.cwd() });
    await execFileAsync("pnpm", [
      "exec", "tsx", "scripts/sync-standard-document.ts",
      "--snapshot", snapshotPath,
      "--document", documentPath,
      "--mode", "check",
    ], { cwd: process.cwd() });

    expect(await readFile(documentPath, "utf8")).toContain("## 十五、当前 1 项标准索引");
  });
});
