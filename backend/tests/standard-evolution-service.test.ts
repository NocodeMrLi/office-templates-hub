import { describe, expect, test } from "vitest";

import { AssetStandardEngine } from "../src/domain/asset-standard-engine.js";
import { StandardEvolutionService } from "../src/domain/standard-evolution-service.js";

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
  access_tier: "free",
} as const;

describe("StandardEvolutionService", () => {
  test("creates a review candidate for stronger reusable rules without mutating the current standard", () => {
    const snapshot = AssetStandardEngine.fromAssets([BASE_ASSET], "1.0.0").snapshot();
    const stronger = {
      ...BASE_ASSET,
      public_id: "tpl_risk_review",
      display_name: "项目风险登记表（复盘版）",
      variant: "review",
      variant_label: "复盘版",
      roles: [...BASE_ASSET.roles, "复核人"],
      field_names: [...BASE_ASSET.field_names, "根因分析", "复核结论"],
    };

    const report = new StandardEvolutionService().scan(snapshot, [stronger]);

    expect(report).toMatchObject({
      schema_version: "office-standard-evolution/v1",
      base_version: "1.0.0",
      scanned_asset_count: 1,
      candidates: [{
        standard_id: "risk_register::通用项目管理",
        status: "candidate",
        improvements: {
          fields: ["复核结论", "根因分析"],
          roles: ["复核人"],
          variants: ["review"],
        },
        requires_review: true,
      }],
    });
    expect(snapshot.version).toBe("1.0.0");
    expect(snapshot.standards[0]?.recommended_fields).not.toContain("根因分析");
  });

  test("records no change when a new asset adds no stronger reusable rule", () => {
    const snapshot = AssetStandardEngine.fromAssets([BASE_ASSET], "1.0.0").snapshot();
    const duplicateRules = { ...BASE_ASSET, public_id: "tpl_risk_copy" };

    const report = new StandardEvolutionService().scan(snapshot, [duplicateRules]);

    expect(report.candidates).toEqual([]);
    expect(report.no_change).toEqual([{
      public_id: "tpl_risk_copy",
      standard_id: "risk_register::通用项目管理",
      reason: "no stronger reusable rule",
    }]);
  });

  test("promotes only after review, regression, and rollback binding", () => {
    const snapshot = AssetStandardEngine.fromAssets([BASE_ASSET], "1.0.0").snapshot();
    const report = new StandardEvolutionService().scan(snapshot, [{
      ...BASE_ASSET,
      public_id: "tpl_risk_review",
      field_names: [...BASE_ASSET.field_names, "根因分析"],
    }]);
    const service = new StandardEvolutionService();

    expect(() => service.promote(snapshot, report, {
      approvedBy: "",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    })).toThrow("review approval required");
    expect(() => service.promote(snapshot, report, {
      approvedBy: "reviewer",
      regressionPassed: false,
      rollbackVersion: "1.0.0",
    })).toThrow("regression must pass");

    const promoted = service.promote(snapshot, report, {
      approvedBy: "reviewer",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    });

    expect(promoted.snapshot.version).toBe("1.0.1");
    expect(promoted.snapshot.standards[0]?.recommended_fields).toContain("根因分析");
    expect(promoted.change_record).toMatchObject({
      from_version: "1.0.0",
      to_version: "1.0.1",
      rollback_version: "1.0.0",
      approved_by: "reviewer",
      regression_passed: true,
    });
  });

  test("keeps complete facts when a new scoped standard is promoted", () => {
    const snapshot = AssetStandardEngine.fromAssets([BASE_ASSET], "1.0.0").snapshot();
    const newIndustryAsset = {
      ...BASE_ASSET,
      public_id: "tpl_risk_manufacturing",
      industry: "生产制造",
      roles: ["生产经理", "风险责任人"],
      project_phase: "生产执行",
      purpose: "识别生产风险",
      output: "生产风险台账",
    };
    const service = new StandardEvolutionService();
    const report = service.scan(snapshot, [newIndustryAsset]);

    const promoted = service.promote(snapshot, report, {
      approvedBy: "reviewer",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    });

    expect(promoted.snapshot.standards).toContainEqual(expect.objectContaining({
      standard_id: "risk_register::生产制造",
      intent_name: "风险登记",
      project_phases: ["生产执行"],
      purposes: ["识别生产风险"],
      outputs: ["生产风险台账"],
      roles: expect.arrayContaining(["生产经理", "风险责任人"]),
      source_asset_count: 1,
    }));
  });

  test("does not publish a new version when the scan has no candidate", () => {
    const snapshot = AssetStandardEngine.fromAssets([BASE_ASSET], "1.0.0").snapshot();
    const service = new StandardEvolutionService();
    const report = service.scan(snapshot, [{ ...BASE_ASSET, public_id: "tpl_risk_copy" }]);

    expect(() => service.promote(snapshot, report, {
      approvedBy: "reviewer",
      regressionPassed: true,
      rollbackVersion: "1.0.0",
    })).toThrow("no standard candidate");
  });
});
