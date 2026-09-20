import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import ExcelJS from "exceljs";
import { afterEach, describe, expect, test } from "vitest";

import { AssetStandardEngine } from "../src/domain/asset-standard-engine.js";
import { resolveSkillRequest } from "../src/skill-cli.js";

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
};

const temporaryDirectories: string[] = [];
const execFileAsync = promisify(execFile);

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe("local office spreadsheet Skill entry", () => {
  test("returns the public asset id instead of regenerating an exact match", async () => {
    const snapshot = AssetStandardEngine.fromAssets([ASSET], "1.0.0").snapshot();
    const result = await resolveSkillRequest({ query: "项目风险登记表" }, [ASSET], snapshot);

    expect(result.decision).toBe("direct_asset");
    expect(result.next_action).toEqual({
      type: "download_public_asset",
      public_id: "tpl_risk_standard",
    });
    expect(result.output_path).toBeNull();
  });

  test("loads the configured active standard snapshot in the command-line entry", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-skill-standards-"));
    temporaryDirectories.push(directory);
    const requestPath = join(directory, "request.json");
    const catalogPath = join(directory, "catalog.json");
    const standardsPath = join(directory, "standards.json");
    await writeFile(requestPath, JSON.stringify({
      query: "做一份风险登记表",
      required_fields: ["根因分析", "复核结论", "整改期限"],
    }), "utf8");
    await writeFile(catalogPath, JSON.stringify({ count: 1, items: [ASSET] }), "utf8");
    await writeFile(
      standardsPath,
      JSON.stringify(AssetStandardEngine.fromAssets([ASSET], "9.9.9").snapshot()),
      "utf8",
    );

    const { stdout } = await execFileAsync("pnpm", [
      "exec", "tsx", "backend/src/skill-cli.ts",
      "--request", requestPath,
      "--catalog", catalogPath,
      "--standards", standardsPath,
    ], { cwd: process.cwd() });
    const result = JSON.parse(stdout) as { specification?: { source?: { standard_version?: string } } };

    expect(result.specification?.source?.standard_version).toBe("9.9.9");
  });

  test("renders a usable xlsx after standard generation passes the shared quality gate", async () => {
    const directory = await mkdtemp(join(tmpdir(), "office-skill-"));
    temporaryDirectories.push(directory);
    const outputPath = join(directory, "risk.xlsx");

    const snapshot = AssetStandardEngine.fromAssets([ASSET], "1.0.0").snapshot();
    const result = await resolveSkillRequest({
      query: "做一份风险登记表",
      required_fields: ["根因分析", "复核结论", "整改期限"],
      roles: ["复核人"],
    }, [ASSET], snapshot, outputPath);

    expect(result.decision).toBe("generate_from_standard");
    expect(result.quality?.passed).toBe(true);
    expect(result.output_path).toBe(outputPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await readFile(outputPath)) as never);
    expect(workbook.getWorksheet("模板")?.getCell("A1").value).toBe("风险登记表");
  });
});
